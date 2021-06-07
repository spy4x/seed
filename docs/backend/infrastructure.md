# Infrastructure

The app is build using Google Cloud Platform (GCP) and Firebase.

Serverless approach is used mainly.

## Diagram:
![diagram](https://files.slack.com/files-pri/TTU88H093-F02281S3ZGQ/screenshot_2021-05-11_at_14.33.48.png?pub_secret=5bbe4faeb3)

## Cloud products used:
- Google Cloud Run
- Google Cloud SQL (for PostgreSQL)
- Google Cloud Tasks
- Google Cloud Logging
- Google Cloud IAM
- Firebase Authentication
- Firebase Hosting (for future Admin Panel)
- Firebase Storage
- Sentry (for error logging)

## Basic idea:
0. Frontend apps (iOS & future Admin Panel) communicate with backend via REST/GRAPHQL API.
0. API is build using Nest.js framework
0. Docker container with API app is deployed to Google Cloud Run (GCR).
0. GCR scales API up and down in serverless way.
0. GCR connects with Google Cloud SQL to get access to production PostgreSQL DB.
0. Cloud SQL keeps DB up and runnning, tracks usage, makes automatic backups and provides replication.
0. API communicates with Google Cloud Tasks to schedule tasks in the future.
0. Firebase Authentication is used on frontend side to do user authentication (email+password, passwordless, Google, Facebook, Twitter, Phone auth, etc) and returns JWT.
0. JWT is used to verify user's requests on API side and Cloud Storage.
0. Cloud Storage is used for files storage (upload/download static resources).
0. API also uses Cloud Memorystore (serves Redis) for caching and Cloud Logging/Sentry for logs/errors.
0. Firebase Hosting hosts Admin Panel and Web Client apps.
