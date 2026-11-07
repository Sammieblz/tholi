locals {
  capacity          = jsondecode(file("${path.module}/../capacity.json")).google
  connection_budget = local.capacity.apiReplicas * local.capacity.apiPool + local.capacity.workerReplicas * local.capacity.workerPool + local.capacity.identityConnections + local.capacity.migrationConnections + local.capacity.operationsConnections + local.capacity.rolloutConnections + local.capacity.headroomConnections
  roles             = toset(["api", "worker", "migration"])
  proxy_image       = "gcr.io/cloud-sql-connectors/cloud-sql-proxy:2.19.0@sha256:5943ac94c0309ddf879ab11384b85781f1381524312911e38789daf4b61faa8a"
  fixed_environment = {
    NODE_ENV                           = "production"
    NODE_OPTIONS                       = "--max-old-space-size=192"
    THOLI_MODEL_PROVIDER               = "fake"
    THOLI_NAVIGATION_TRANSPORT_ENABLED = "false"
    THOLI_BYOK_ENABLED                 = "false"
    THOLI_SUPPORT_ENABLED              = "false"
  }
  api_environment = merge(var.api_environment, local.fixed_environment, {
    THOLI_SERVICE_HOST          = "0.0.0.0"
    THOLI_SERVICE_PORT          = "8788"
    THOLI_SERVICE_PUBLIC_ORIGIN = "https://${var.api_domain}"
    THOLI_DATABASE_POOL_MAX     = tostring(local.capacity.apiPool)
    }
  )
  worker_environment = merge(local.fixed_environment, {
    THOLI_DATABASE_POOL_MAX  = tostring(local.capacity.workerPool)
    THOLI_WORKER_HEALTH_PORT = "8081"
    }
  )
  migration_environment = {
    NODE_ENV                    = "production"
    THOLI_DATABASE_POOL_MAX     = "1"
    THOLI_DATABASE_RUNTIME_ROLE = "tholi_runtime"
    THOLI_DATABASE_WORKER_ROLE  = "tholi_worker"
  }
  secret_grants = merge([
    for role, refs in var.secrets : {
      for name, ref in refs : "${role}-${name}" => {
        role   = role
        secret = ref.secret
      }
    }
  ]...)
  proxy_arguments = ["--private-ip", "--address=127.0.0.1", "--port=5432", "--health-check", "--http-address=0.0.0.0", "--quiet", google_sql_database_instance.service.connection_name]
}
resource "terraform_data" "authorization" {
  lifecycle {
    precondition {
      condition     = var.allow_provisioning
      error_message = "Provisioning is disabled. Obtain separate budget and release authorization before an operator enables this interlock."
    }
    precondition {
      condition     = local.connection_budget <= local.capacity.databaseConnections
      error_message = "The deployment exceeds its database connection allocation."
    }
  }
}
resource "google_compute_network" "service" {
  name                    = "${var.name}-private"
  auto_create_subnetworks = false
  depends_on              = [terraform_data.authorization]
}
resource "google_compute_subnetwork" "service" {
  name                     = "${var.name}-run"
  region                   = var.region
  network                  = google_compute_network.service.id
  ip_cidr_range            = "10.74.0.0/24"
  private_ip_google_access = true
}
resource "google_compute_global_address" "sql" {
  name          = "${var.name}-sql-private"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 20
  network       = google_compute_network.service.id
}
resource "google_service_networking_connection" "sql" {
  network                 = google_compute_network.service.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.sql.name]
}
resource "google_sql_database_instance" "service" {
  name                = "${var.name}-postgres"
  region              = var.region
  database_version    = "POSTGRES_18"
  deletion_protection = true
  settings {
    tier              = "db-custom-2-7680"
    edition           = "ENTERPRISE"
    availability_type = "REGIONAL"
    disk_size         = 20
    disk_autoresize   = true
    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.service.id
    }
    database_flags {
      name  = "max_connections"
      value = tostring(local.capacity.databaseConnections)
    }
    database_flags {
      name  = "password_encryption"
      value = "scram-sha-256"
    }
    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 7
      }
    }
  }
  depends_on = [google_service_networking_connection.sql]
}
resource "google_service_account" "runtime" {
  for_each     = local.roles
  account_id   = "${var.name}-${each.key}"
  display_name = "Tholi ${each.key} runtime"
  depends_on   = [terraform_data.authorization]
}
resource "google_project_iam_member" "sql" {
  for_each = local.roles
  project  = var.project_id
  role     = "roles/cloudsql.client"
  member   = "serviceAccount:${google_service_account.runtime[each.key].email}"
}
resource "google_secret_manager_secret_iam_member" "runtime" {
  for_each  = local.secret_grants
  project   = var.project_id
  secret_id = each.value.secret
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime[each.value.role].email}"
}
resource "google_cloud_run_v2_service" "api" {
  count               = var.enable_workloads ? 1 : 0
  name                = "${var.name}-api"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  deletion_protection = true
  template {
    service_account                  = google_service_account.runtime["api"].email
    timeout                          = "35s"
    max_instance_request_concurrency = 32
    scaling {
      min_instance_count = 0
      max_instance_count = local.capacity.apiReplicas
    }
    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"
      network_interfaces {
        network    = google_compute_network.service.id
        subnetwork = google_compute_subnetwork.service.id
      }
    }
    containers {
      name       = "api"
      image      = var.service_image
      command    = ["node", "apps/api/dist/service.js"]
      depends_on = ["sql"]
      ports {
        container_port = 8788
      }
      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = true
      }
      dynamic "env" {
        for_each = local.api_environment
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = var.secrets.api
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value.secret
              version = env.value.version
            }
          }
        }
      }
      startup_probe {
        http_get {
          path = "/health/ready"
          port = 8788
        }
        period_seconds    = 5
        failure_threshold = 24
      }
      liveness_probe {
        http_get {
          path = "/health/live"
          port = 8788
        }
        period_seconds = 10
      }
    }
    containers {
      name  = "sql"
      image = local.proxy_image
      args  = concat(local.proxy_arguments, ["--max-connections=8", "--lazy-refresh"])
      resources {
        limits = {
          cpu    = "1"
          memory = "256Mi"
        }
      }
      startup_probe {
        http_get {
          path = "/startup"
          port = 9090
        }
        period_seconds = 5
      }
    }
  }
  depends_on = [google_project_iam_member.sql, google_secret_manager_secret_iam_member.runtime, google_logging_project_exclusion.auth_requests]
}
resource "google_cloud_run_v2_worker_pool" "worker" {
  count               = var.enable_workloads ? 1 : 0
  name                = "${var.name}-worker"
  location            = var.region
  deletion_protection = true
  scaling {
    scaling_mode          = "MANUAL"
    manual_instance_count = var.worker_instances
  }
  template {
    service_account = google_service_account.runtime["worker"].email
    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"
      network_interfaces {
        network    = google_compute_network.service.id
        subnetwork = google_compute_subnetwork.service.id
      }
    }
    containers {
      name       = "worker"
      image      = var.service_image
      command    = ["node", "apps/api/dist/worker.js"]
      depends_on = ["sql"]
      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
      dynamic "env" {
        for_each = local.worker_environment
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = var.secrets.worker
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value.secret
              version = env.value.version
            }
          }
        }
      }
      startup_probe {
        http_get {
          path = "/health/ready"
          port = 8081
        }
        period_seconds    = 5
        failure_threshold = 24
      }
      liveness_probe {
        http_get {
          path = "/health/live"
          port = 8081
        }
        period_seconds = 10
      }
    }
    containers {
      name  = "sql"
      image = local.proxy_image
      args  = concat(local.proxy_arguments, ["--max-connections=4"])
      resources {
        limits = {
          cpu    = "1"
          memory = "256Mi"
        }
      }
      startup_probe {
        http_get {
          path = "/startup"
          port = 9090
        }
        period_seconds = 5
      }
    }
  }
  depends_on = [google_project_iam_member.sql, google_secret_manager_secret_iam_member.runtime]
}
resource "google_cloud_run_v2_job" "migration" {
  name                = "${var.name}-migrate"
  location            = var.region
  deletion_protection = true
  template {
    task_count  = 1
    parallelism = 1
    template {
      service_account = google_service_account.runtime["migration"].email
      timeout         = "300s"
      max_retries     = 0
      vpc_access {
        egress = "PRIVATE_RANGES_ONLY"
        network_interfaces {
          network    = google_compute_network.service.id
          subnetwork = google_compute_subnetwork.service.id
        }
      }
      containers {
        name       = "migration"
        image      = var.service_image
        depends_on = ["sql"]
        command    = ["node", "--input-type=module", "-e"]
        # The same migration CLI owns schema changes. This wrapper only stops
        # the job's otherwise continuous proxy after the command exits.
        args = [file("${path.module}/migrate-with-proxy.mjs")]
        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }
        dynamic "env" {
          for_each = local.migration_environment
          content {
            name  = env.key
            value = env.value
          }
        }
        dynamic "env" {
          for_each = var.secrets.migration
          content {
            name = env.key
            value_source {
              secret_key_ref {
                secret  = env.value.secret
                version = env.value.version
              }
            }
          }
        }
      }
      containers {
        name  = "sql"
        image = local.proxy_image
        args  = concat(local.proxy_arguments, ["--max-connections=2", "--quitquitquit", "--exit-zero-on-sigterm"])
        resources {
          limits = {
            cpu    = "1"
            memory = "256Mi"
          }
        }
        startup_probe {
          http_get {
            path = "/startup"
            port = 9090
          }
          period_seconds = 5
        }
      }
    }
  }
  depends_on = [google_project_iam_member.sql, google_secret_manager_secret_iam_member.runtime]
}
