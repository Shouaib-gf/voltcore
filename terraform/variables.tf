variable "proxmox_api_url" {
  type = string
}

variable "proxmox_api_token" {
  type      = string
  sensitive = true
}

variable "proxmox_node" {
  type    = string
  default = "pve"
}

variable "vm_name" {
  type = string
}

variable "vm_id" {
  type = number
}

variable "client_id" {
  type = string
}

variable "client_email" {
  type = string
}

variable "client_ssh_pubkey" {
  type = string
}

variable "datastore" {
  type    = string
  default = "local-lvm"
}

variable "plan" {
  type    = string
  default = "basic"
  validation {
    condition     = contains(["basic","pro","enterprise","custom"], var.plan)
    error_message = "Plan must be basic, pro, enterprise, or custom."
  }
}

variable "os" {
  type    = string
  default = "ubuntu-22.04"
  validation {
    condition     = contains(["ubuntu-22.04","debian-12"], var.os)
    error_message = "OS must be ubuntu-22.04 or debian-12."
  }
}

variable "cpu_cores" {
  type    = number
  default = 2
}

variable "ram_mb" {
  type    = number
  default = 2048
}

variable "disk_gb" {
  type    = number
  default = 40
}
