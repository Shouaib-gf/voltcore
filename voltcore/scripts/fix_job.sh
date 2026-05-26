#!/bin/bash
set -e

JENKINS_USER="${JENKINS_USER:-your-jenkins-user}"
JENKINS_TOKEN="${JENKINS_TOKEN:-your-jenkins-api-token}"
JENKINS_URL="${JENKINS_URL:-http://192.168.1.152:8080}"
JOB_NAME="${JENKINS_JOB:-voltcore-vm-provision}"

# Get crumb
CRUMB=$(curl -s -u ${JENKINS_USER}:${JENKINS_TOKEN} \
  ${JENKINS_URL}/crumbIssuer/api/json | python3 -c \
  import sys,json; d=json.load(sys.stdin); print(d['crumbRequestField']+':'+d['crumb']))

echo Crumb: $CRUMB

# Post config directly - no PowerShell, no encoding issues
curl -s -o /dev/null -w %{http_code} \
  -u ${JENKINS_USER}:${JENKINS_TOKEN} \
  -H $CRUMB \
  -H Content-Type: application/xml \
  --data-binary @/opt/voltcore/jenkins/job_config.xml \
  ${JENKINS_URL}/job/${JOB_NAME}/config.xml

echo  - Done
