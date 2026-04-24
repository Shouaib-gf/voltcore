#!/bin/bash

DATE=$(date +%F)

# Backup Jenkins
tar -czf /opt/voltcore/backups/jenkins_$DATE.tar.gz /var/lib/docker/volumes/jenkins_home/_data

# Backup MinIO (Terraform state)
tar -czf /opt/voltcore/backups/minio_$DATE.tar.gz /var/lib/docker/volumes/minio_data/_data

# Backup project code
tar -czf /opt/voltcore/backups/code_$DATE.tar.gz /opt/voltcore

echo "Backup completed: $DATE"
