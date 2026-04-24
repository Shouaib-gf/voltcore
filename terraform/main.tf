terraform {
  required_providers {
    proxmox = {
      source  = "bpg/proxmox"
      version = "~> 0.50"
    }
  }
  backend "s3" {
    bucket                      = "voltcore-tfstate"
    key                         = "vms/terraform.tfstate"
    region                      = "us-east-1"
    endpoints                   = { s3 = "http://192.168.0.143:9000" }
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_requesting_account_id  = true
    use_path_style              = true
  }
}

provider "proxmox" {
  endpoint  = var.proxmox_api_url
  api_token = var.proxmox_api_token
  insecure  = true
}

resource "proxmox_virtual_environment_vm" "client_vm" {
  name        = var.vm_name
  description = "VoltCore client VM - ${var.client_email}"
  node_name   = var.proxmox_node
  vm_id       = var.vm_id
  tags        = ["voltcore", var.plan, var.client_id]

  clone {
    vm_id   = local.template_ids[var.os]
    full    = true
    retries = 3
  }

  cpu {
    cores   = var.cpu_cores
    sockets = 1
    type    = "x86-64-v2-AES"
  }

  memory {
    dedicated = var.ram_mb
  }

  disk {
    datastore_id = var.datastore
    size         = var.disk_gb
    interface    = "scsi0"
    file_format  = "qcow2"
    discard      = "on"
    iothread     = true
  }

  network_device {
    bridge   = "vmbr0"
    model    = "virtio"
    firewall = false
  }

  operating_system {
    type = "l26"
  }

  initialization {
    ip_config {
      ipv4 { address = "dhcp" }
    }
    user_account {
      username = "voltcore"
      keys     = [var.client_ssh_pubkey]
    }
    dns {
      servers = ["1.1.1.1", "8.8.8.8"]
    }
  }

  lifecycle {
    ignore_changes = [initialization]
  }
}

locals {
  template_ids = {
    "ubuntu-22.04" = 9100
    "debian-12"    = 9001
  }
}

output "vm_id"   { value = proxmox_virtual_environment_vm.client_vm.vm_id }
output "vm_ipv4" { value = proxmox_virtual_environment_vm.client_vm.ipv4_addresses }
output "vm_name" { value = proxmox_virtual_environment_vm.client_vm.name }
