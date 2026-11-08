# Public transport stops here; account and request authority stay in Fastify.
resource "google_cloud_run_v2_service_iam_member" "ingress" {
  count    = var.enable_workloads ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
resource "google_compute_region_network_endpoint_group" "api" {
  count                 = var.enable_workloads ? 1 : 0
  name                  = "${var.name}-api"
  region                = var.region
  network_endpoint_type = "SERVERLESS"
  cloud_run {
    service = google_cloud_run_v2_service.api[0].name
  }
}
resource "google_compute_backend_service" "api" {
  count                 = var.enable_workloads ? 1 : 0
  name                  = "${var.name}-api"
  protocol              = "HTTP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  enable_cdn            = false
  log_config {
    enable = false
  }
  backend {
    group = google_compute_region_network_endpoint_group.api[0].id
  }
}
resource "google_compute_url_map" "api" {
  count           = var.enable_workloads ? 1 : 0
  name            = "${var.name}-api"
  default_service = google_compute_backend_service.api[0].id
}
resource "google_compute_managed_ssl_certificate" "api" {
  count = var.enable_workloads ? 1 : 0
  name  = "${var.name}-api"
  managed {
    domains = [var.api_domain]
  }
  depends_on = [terraform_data.authorization]
}
resource "google_compute_ssl_policy" "api" {
  count           = var.enable_workloads ? 1 : 0
  name            = "${var.name}-api"
  min_tls_version = "TLS_1_2"
  profile         = "MODERN"
  depends_on      = [terraform_data.authorization]
}
resource "google_compute_target_https_proxy" "api" {
  count            = var.enable_workloads ? 1 : 0
  name             = "${var.name}-api"
  url_map          = google_compute_url_map.api[0].id
  ssl_certificates = [google_compute_managed_ssl_certificate.api[0].id]
  ssl_policy       = google_compute_ssl_policy.api[0].id
}
resource "google_compute_global_address" "api" {
  count      = var.enable_workloads ? 1 : 0
  name       = "${var.name}-api"
  depends_on = [terraform_data.authorization]
}
resource "google_compute_global_forwarding_rule" "api" {
  count                 = var.enable_workloads ? 1 : 0
  name                  = "${var.name}-api"
  ip_address            = google_compute_global_address.api[0].address
  port_range            = "443"
  target                = google_compute_target_https_proxy.api[0].id
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

# Cloud Run request URLs can contain authorization codes. Keep those automatic
# request logs out of project storage; application audit remains separately scoped.
resource "google_logging_project_exclusion" "auth_requests" {
  count      = var.enable_workloads ? 1 : 0
  name       = "${var.name}-private-request-urls"
  project    = var.project_id
  filter     = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${var.name}-api\" AND log_id(\"run.googleapis.com/requests\")"
  depends_on = [terraform_data.authorization]
}
output "api_address" {
  value = try(google_compute_global_address.api[0].address, null)
}
output "migration_job" {
  value = google_cloud_run_v2_job.migration.name
}
