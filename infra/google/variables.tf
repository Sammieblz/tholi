variable "allow_provisioning" {
  description = "Execution interlock, not budget or release authorization. Leave false for preparation."
  type        = bool
  default     = false
}
variable "enable_workloads" {
  description = "Second deployment phase, after role bootstrap and a successful one-shot migration."
  type        = bool
  default     = false
}
variable "project_id" {
  type = string
}
variable "region" {
  type = string
}
variable "name" {
  type    = string
  default = "tholi"
}
variable "service_image" {
  type = string
  validation {
    condition     = can(regex("^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$", var.service_image))
    error_message = "Select one reviewed registry image by immutable digest."
  }
}
variable "api_domain" {
  type = string
  validation {
    condition     = can(regex("^[a-z0-9-]+(\\.[a-z0-9-]+)+$", var.api_domain))
    error_message = "Use the exact public API DNS name."
  }
}
variable "api_environment" {
  description = "Nonsecret production OIDC and web-origin configuration only."
  type        = map(string)
  validation {
    condition = alltrue([
      for key in ["THOLI_IDENTITY_ISSUER", "THOLI_IDENTITY_AUTHORIZATION_ENDPOINT", "THOLI_IDENTITY_TOKEN_ENDPOINT", "THOLI_IDENTITY_JWKS_URI", "THOLI_IDENTITY_LOGOUT_ENDPOINT", "THOLI_IDENTITY_WEB_ORIGIN", "THOLI_SERVICE_ORIGINS"] : startswith(lookup(var.api_environment, key, ""), "https://")
      ]) && contains(keys(var.api_environment), "THOLI_IDENTITY_CLIENT_ID") && alltrue([
      for key in keys(var.api_environment) : contains(["THOLI_IDENTITY_ISSUER", "THOLI_IDENTITY_AUTHORIZATION_ENDPOINT", "THOLI_IDENTITY_TOKEN_ENDPOINT", "THOLI_IDENTITY_JWKS_URI", "THOLI_IDENTITY_LOGOUT_ENDPOINT", "THOLI_IDENTITY_WEB_ORIGIN", "THOLI_IDENTITY_CLIENT_ID", "THOLI_IDENTITY_CHROMIUM_CALLBACKS", "THOLI_IDENTITY_FIREFOX_CALLBACKS", "THOLI_SERVICE_ORIGINS"], key)
    ])
    error_message = "Configure production HTTPS identity/origins; credentials belong in versioned secret references."
  }
  validation {
    condition     = var.api_domain == trimsuffix(trimprefix(lookup(var.api_environment, "THOLI_IDENTITY_WEB_ORIGIN", ""), "https://"), "/") || endswith(var.api_domain, ".${trimsuffix(trimprefix(lookup(var.api_environment, "THOLI_IDENTITY_WEB_ORIGIN", ""), "https://"), "/")}") || endswith(trimsuffix(trimprefix(lookup(var.api_environment, "THOLI_IDENTITY_WEB_ORIGIN", ""), "https://"), "/"), ".${var.api_domain}")
    error_message = "Preserve the existing parent/child website and API cookie-domain topology."
  }
}
variable "secrets" {
  description = "Existing secret IDs and numeric versions only. Never provide secret values in Terraform."
  type = object({
    api = map(object({
      secret  = string
      version = string
      }
    ))
    worker = map(object({
      secret  = string
      version = string
      }
    ))
    migration = map(object({
      secret  = string
      version = string
      }
    ))
    }
  )
  validation {
    condition = alltrue(flatten([
      for role, entries in var.secrets : [for key, ref in entries : can(regex("^[1-9][0-9]*$", ref.version)) && can(regex("^[A-Za-z0-9_-]+$", ref.secret)) && contains({ api = ["THOLI_DATABASE_URL", "THOLI_IDENTITY_CLIENT_SECRET_KEY", "THOLI_IDENTITY_FLOW_SECRET_KEY"], worker = ["THOLI_DATABASE_WORKER_URL"], migration = ["THOLI_DATABASE_MIGRATION_URL"] }[role], key)]
      ])) && alltrue([
      for key in ["THOLI_DATABASE_URL", "THOLI_IDENTITY_CLIENT_SECRET_KEY", "THOLI_IDENTITY_FLOW_SECRET_KEY"] : contains(keys(var.secrets.api), key)
    ]) && contains(keys(var.secrets.worker), "THOLI_DATABASE_WORKER_URL") && contains(keys(var.secrets.migration), "THOLI_DATABASE_MIGRATION_URL")
    error_message = "Each role needs its own database secret; API needs identity secrets. Pin numeric versions."
  }
  validation {
    condition     = length(distinct(flatten([for role, refs in var.secrets : [for ref in values(refs) : ref.secret]]))) == 5
    error_message = "Keep API, worker, migration and identity secret material in distinct secret records."
  }
}
variable "worker_instances" {
  type    = number
  default = 1
  validation {
    condition     = var.worker_instances >= 0 && var.worker_instances <= 2 && floor(var.worker_instances) == var.worker_instances
    error_message = "Manual worker capacity must remain between zero and two."
  }
}
