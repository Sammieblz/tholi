mock_provider "google" {
}
variables {
  project_id    = "tholi-offline-fixture"
  region        = "us-central1"
  service_image = "example.invalid/tholi@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  api_domain    = "api.example.test"
  api_environment = {
    THOLI_IDENTITY_ISSUER                 = "https://identity.example.test/realms/tholi"
    THOLI_IDENTITY_AUTHORIZATION_ENDPOINT = "https://identity.example.test/auth"
    THOLI_IDENTITY_TOKEN_ENDPOINT         = "https://identity.example.test/token"
    THOLI_IDENTITY_JWKS_URI               = "https://identity.example.test/certs"
    THOLI_IDENTITY_LOGOUT_ENDPOINT        = "https://identity.example.test/logout"
    THOLI_IDENTITY_WEB_ORIGIN             = "https://example.test"
    THOLI_SERVICE_ORIGINS                 = "https://example.test"
    THOLI_IDENTITY_CLIENT_ID              = "tholi-service"
  }
  secrets = {
    api = {
      THOLI_DATABASE_URL = {
        secret  = "api-database"
        version = "1"
      }
      THOLI_IDENTITY_CLIENT_SECRET_KEY = {
        secret  = "oidc-client"
        version = "2"
      }
      THOLI_IDENTITY_FLOW_SECRET_KEY = {
        secret  = "oidc-flow"
        version = "3"
      }
    }
    worker = {
      THOLI_DATABASE_WORKER_URL = {
        secret  = "worker-database"
        version = "1"
      }
    }
    migration = {
      THOLI_DATABASE_MIGRATION_URL = {
        secret  = "migration-database"
        version = "1"
      }
    }
  }
}
run "provisioning_disabled_by_default" {
  command         = plan
  expect_failures = [terraform_data.authorization]
}
run "portable_preparation" {
  command = plan
  variables {
    allow_provisioning = true
    enable_workloads   = true
  }
  assert {
    condition     = google_cloud_run_v2_service.api[0].template[0].containers[0].image == var.service_image && google_cloud_run_v2_worker_pool.worker[0].template[0].containers[0].image == var.service_image && google_cloud_run_v2_job.migration.template[0].template[0].containers[0].image == var.service_image
    error_message = "API, continuous worker and migration must reuse the same application bytes."
  }
  assert {
    condition     = !google_sql_database_instance.service.settings[0].ip_configuration[0].ipv4_enabled && !google_compute_backend_service.api[0].enable_cdn && google_cloud_run_v2_service.api[0].ingress == "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
    error_message = "Database must stay private, API uncached and direct public Run ingress closed."
  }
  assert {
    condition     = google_cloud_run_v2_service.api[0].scaling[0].max_instance_count == 4 && google_cloud_run_v2_worker_pool.worker[0].scaling[0].manual_instance_count == 1 && length(google_secret_manager_secret_iam_member.runtime) == 5 && google_cloud_run_v2_job.migration.template[0].template[0].max_retries == 0
    error_message = "Keep finite capacity, per-secret role grants and no automatic migration retry."
  }
  assert {
    condition     = alltrue([for flag in google_sql_database_instance.service.settings[0].database_flags : flag.name != "log_error_verbosity" || flag.value == "terse"]) && length([for flag in google_sql_database_instance.service.settings[0].database_flags : flag if flag.name == "log_parameter_max_length_on_error" && flag.value == "0"]) == 1
    error_message = "Database logging must omit row details and parameter values."
  }
}
run "foundation_before_workloads" {
  command = plan
  variables { allow_provisioning = true }
  assert {
    condition     = length(google_cloud_run_v2_service.api) == 0 && length(google_cloud_run_v2_worker_pool.worker) == 0 && google_cloud_run_v2_job.migration.template[0].template[0].containers[0].image == var.service_image
    error_message = "Prepare infrastructure and the migration command before starting workloads."
  }
}
run "worker_capacity_is_bounded" {
  command = plan
  variables {
    allow_provisioning = true
    worker_instances   = 3
  }
  expect_failures = [var.worker_instances]
}
