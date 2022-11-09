⚠️ This document is WIP. It will be used to create a script that initializes the whole Google Cloud structure for you automatically.
Project initialization (for new users)

MANUALLY:
1. Install [Google Cloud CLI](https://cloud.google.com/sdk/docs/install)
2. Authenticate in Google Cloud CLI `gcloud auth login`
3. Install [Firebase CLI](https://firebase.google.com/docs/cli)
4. Authenticate in Firebase CLI `firebase login`
5. Create Firebase Hosting Sites for Admin Panel & Web Client: `firebase hosting:sites:create SITE_ID`
6. Add created sites to the list of trusted domains for Firebase Authentication.


FOR SCRIPT:
```
# Environment variables:
PROJECT_ID=FILL_WITH_YOUR_VALUE
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
CLOUD_RUN_API_APP_NAME=api
REGION=us-central1
FRONT_WEB_CLIENT_HOSTING_TARGET=seed-web-client
FRONT_ADMIN_PANEL_HOSTING_TARGET=seed-admin-panel
API_KEY_CLOUD_TASKS=$(uuidgen)
```

```
# Enable APIs
gcloud services enable --project "${PROJECT_ID}" \
  containerregistry.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com \
  firebase.googleapis.com \
  redis.googleapis.com
```

```
# Configure GCloud CLI
gcloud config set run/platform managed
gcloud config set run/region $REGION
# Configure Docker to have access to Google Cloud Container Registry
gcloud auth configure-docker
```

```
# [MOVE TO TERRAFORM] Create SQL instance and get connection name
TODO
CLOUD_SQL_INSTANCE_NAME=TODO
DB_CONNECTION_STRING=TODO
gcloud sql instances create $CLOUD_SQL_INSTANCE_NAME \
--database-version=POSTGRES_13 \
--region=$REGION \
--tier=db-f1-micro \
--authorized-networks=<AUTHORIZED_IP> \
--root-password=DB_PASSWORD
# outputs DB IP address
```


```
# [MAKE THROUGH TERRAFORM?] Grant Cloud Build permission to manage Cloud Run
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member=serviceAccount:$PROJECT_NUMBER@cloudbuild.gserviceaccount.com \
    --role=roles/run.admin
gcloud iam service-accounts add-iam-policy-binding \
    $PROJECT_NUMBER-compute@developer.gserviceaccount.com \
    --member=serviceAccount:$PROJECT_NUMBER@cloudbuild.gserviceaccount.com \
    --role=roles/iam.serviceAccountUser

# [MAKE THROUGH TERRAFORM?] Grant Cloud Build permission to deploy Firebase
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member=serviceAccount:$PROJECT_NUMBER@cloudbuild.gserviceaccount.com \
    --role=roles/firebase.admin

# [MAKE THROUGH TERRAFORM?] Grant Cloud Build permission to access Secret Manager
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member=serviceAccount:$PROJECT_NUMBER@cloudbuild.gserviceaccount.com \
    --role=roles/secretmanager.secretAccessor

# [MAKE THROUGH TERRAFORM?] Create a separate service account for Cloud Run "api" service
gcloud iam service-accounts create cloud-run-api \
    --description="API backend Node application" \
    --display-name="cloud-run-api"
# [MAKE THROUGH TERRAFORM?] Grant role to create Cloud Tasks
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:cloud-run-api@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/cloudtasks.enqueuer"
# [MAKE THROUGH TERRAFORM?] Grant role to delete Cloud Tasks
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:cloud-run-api@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/cloudtasks.taskDeleter"
# [MAKE THROUGH TERRAFORM?] Grant role to access Firebase Admin SDK
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:cloud-run-api@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/firebase.sdkAdminServiceAgent"
# [MAKE THROUGH TERRAFORM?] Grant role to connect to Cloud SQL
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:cloud-run-api@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/cloudsql.client"
```

```
# TODO: add bucket lifecycle rule
# Deploy custom builder
docker build . -t gcr.io/$PROJECT_ID/builder -f cloud-build/builder.dockerfile
docker push gcr.io/$PROJECT_ID/builder
```

```
# [MAKE THROUGH TERRAFORM] Fill Secrets
echo -n $REGION | \
    gcloud secrets create REGION --data-file=-

echo -n $CLOUD_RUN_API_APP_NAME | \
    gcloud secrets create CLOUD_RUN_API_APP_NAME --data-file=-

API_URL=gcloud run services describe $CLOUD_RUN_API_APP_NAME --format='value(status.url)'
echo -n $API_URL | \
    gcloud secrets create API_URL --data-file=-

echo -n "postgresql://postgres:uL9xjQk6VzWnd4vVNXwiHVe6rv4ALJ@localhost/postgres?host=/cloudsql/seed-anton:us-central1:seed-db" | \
    gcloud secrets create DB_CONNECTION_STRING --data-file=-

echo -n "main" | \
    gcloud secrets create CLOUD_SQL_INSTANCE_NAME --data-file=-

echo -n $FRONT_WEB_CLIENT_HOSTING_TARGET | \
    gcloud secrets create FRONT_WEB_CLIENT_HOSTING_TARGET --data-file=-

echo -n $FRONT_ADMIN_PANEL_HOSTING_TARGET | \
    gcloud secrets create FRONT_ADMIN_PANEL_HOSTING_TARGET --data-file=-
    
echo -n $API_KEY_CLOUD_TASKS | \
    gcloud secrets create API_KEY_CLOUD_TASKS --data-file=-
```

# TODO: generate .envs/* files
# TODO: generate ssh key and add it to GitHub deploy keys
ssh-keygen -t ed25519 -C "your_email@example.com"

OPTIONAL:
- How to init Nx Cloud accessToken private key
