#!/bin/bash
set -e

JENKINS_USER=Shouaib
JENKINS_TOKEN=11d0609b21bf69fb86359f7a08ed5246bf
JENKINS_URL=http://192.168.0.143:8080
JOB_NAME=voltcore-vm-provision

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
