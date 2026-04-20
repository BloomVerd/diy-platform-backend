# AWS Lambda Transcoding — Setup Guide

This document explains how to deploy the transcoding Lambda function and wire the NestJS backend to invoke it via `LambdaTranscodingStrategy`.

---

## Table of Contents

1. [How It Works](#1-how-it-works)
2. [Prerequisites](#2-prerequisites)
3. [Lambda Setup](#3-lambda-setup)
4. [IAM Permissions](#4-iam-permissions)
5. [NestJS Configuration](#5-nestjs-configuration)
6. [Switching the Active Strategy](#6-switching-the-active-strategy)
7. [Request / Response Contract](#7-request--response-contract)
8. [Recommended Lambda Configuration](#8-recommended-lambda-configuration)
9. [Environment Variables Reference](#9-environment-variables-reference)

---

## 1. How It Works

```
BullMQ: video-transcoding queue
        │
        ▼
TranscodingProcessor.process(job)
        │
        └─► LambdaTranscodingStrategy.transcode(videoId, objectKey, variants)
                    │
                    │  AWS Lambda InvokeCommand (RequestResponse — synchronous)
                    │  Payload: { videoId, objectKey, variants }
                    │
                    ▼
         Lambda: transcoding-handler.js  (Node.js 20.x)
                    │
                    ├─ Download raw video from R2 (S3-compatible API)
                    ├─ ffprobe: probe duration
                    ├─ ffmpeg:  extract thumbnail at 5% of duration
                    ├─ ffmpeg:  transcode each variant to HLS segments
                    ├─ Upload all artefacts back to R2
                    │
                    └─► Return TranscodingResult JSON
                    │
        ▼
TranscodingProcessor updates DB (video_assets, video_variants, videos)
```

Unlike the Cloudflare Worker, Lambda runs on **Amazon Linux** so it can execute the native `ffmpeg` binary — no WASM required.

---

## 2. Prerequisites

| Requirement | Notes |
|---|---|
| AWS account | Free tier is sufficient for low volumes |
| AWS CLI | `brew install awscli` then `aws configure` |
| Node.js 20.x | For packaging the Lambda ZIP |
| Cloudflare R2 credentials | The Lambda reads/writes R2 via the S3-compatible API |

---

## 3. Lambda Setup

### 3.1 Install Lambda dependencies

```bash
cd lambda
npm install
```

This installs `fluent-ffmpeg`, `ffmpeg-static`, `@ffprobe-installer/ffprobe`, and the AWS SDK. Wrangler is not involved — Lambda is deployed as a ZIP file.

### 3.2 Package the ZIP

```bash
cd lambda
zip -r ../transcoding-lambda.zip . -x "*.DS_Store"
```

The ZIP must include `node_modules/` — Lambda does not run `npm install` on deploy.

### 3.3 Create the Lambda function

```bash
aws lambda create-function \
  --function-name diy-transcoding \
  --runtime nodejs20.x \
  --handler transcoding-handler.handler \
  --role arn:aws:iam::<your-account-id>:role/diy-transcoding-role \
  --zip-file fileb://../transcoding-lambda.zip \
  --timeout 900 \
  --memory-size 3008 \
  --ephemeral-storage '{"Size": 10240}' \
  --region us-east-1
```

### 3.4 Set Lambda environment variables

The Lambda function needs its own credentials to reach Cloudflare R2. These are **separate** from the NestJS app's R2 credentials (though they can be the same values):

```bash
aws lambda update-function-configuration \
  --function-name diy-transcoding \
  --environment "Variables={
    R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com,
    R2_ACCESS_KEY_ID=<your-r2-access-key>,
    R2_SECRET_ACCESS_KEY=<your-r2-secret-key>,
    R2_BUCKET=diy-aws-bucket
  }"
```

### 3.5 Update the function (redeploy)

After making code changes:

```bash
cd lambda
zip -r ../transcoding-lambda.zip . -x "*.DS_Store"
aws lambda update-function-code \
  --function-name diy-transcoding \
  --zip-file fileb://../transcoding-lambda.zip
```

---

## 4. IAM Permissions

The Lambda function needs an **execution role** with these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

That's it — R2 access uses its own API keys inside the function, not AWS IAM.

### Create the role

```bash
# Create the role
aws iam create-role \
  --role-name diy-transcoding-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }]
  }'

# Attach basic Lambda execution policy
aws iam attach-role-policy \
  --role-name diy-transcoding-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
```

### NestJS IAM user (invokes Lambda)

The NestJS app needs a separate IAM user with permission to call `lambda:InvokeFunction`:

```bash
# Create IAM user for NestJS
aws iam create-user --user-name diy-backend

# Attach inline policy
aws iam put-user-policy \
  --user-name diy-backend \
  --policy-name InvokeTranscodingLambda \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": "arn:aws:lambda:us-east-1:<your-account-id>:function:diy-transcoding"
    }]
  }'

# Create access key — copy the output, you only see it once
aws iam create-access-key --user-name diy-backend
```

Use the `AccessKeyId` and `SecretAccessKey` from the last command as `LAMBDA_ACCESS_KEY_ID` and `LAMBDA_SECRET_ACCESS_KEY` in your NestJS `.env`.

---

## 5. NestJS Configuration

Add to your `.env` (or `.env.development.local`):

```env
LAMBDA_FUNCTION_NAME=diy-transcoding
LAMBDA_REGION=us-east-1
LAMBDA_ACCESS_KEY_ID=<iam-user-access-key>
LAMBDA_SECRET_ACCESS_KEY=<iam-user-secret-key>
```

---

## 6. Switching the Active Strategy

Open `src/video/video.module.ts` and swap the provider:

```typescript
// Add import
import { LambdaTranscodingStrategy } from './processing/lambda-transcoding.strategy';

// Change provider binding
{ provide: TranscodingStrategy, useClass: LambdaTranscodingStrategy }
```

`TranscodingProcessor` needs no changes.

---

## 7. Request / Response Contract

### Payload sent to Lambda

```json
{
  "videoId":   "6c863245-1646-42ca-9776-3a9dbefe62c4",
  "objectKey": "raw/<creatorId>/<videoId>/filename.mp4",
  "variants":  ["360p", "720p", "1080p"]
}
```

### Response returned by Lambda

```json
{
  "masterManifestKey": "manifests/<videoId>/master.m3u8",
  "thumbnailKey":      "thumbnails/<videoId>/thumb_0.jpg",
  "durationSec":       183,
  "variants": [
    { "resolution": "360P",  "bitrate": 800000,  "codec": "h264", "manifestPath": "manifests/<videoId>/360p/index.m3u8" },
    { "resolution": "720P",  "bitrate": 2500000, "codec": "h264", "manifestPath": "manifests/<videoId>/720p/index.m3u8" },
    { "resolution": "1080P", "bitrate": 5000000, "codec": "h264", "manifestPath": "manifests/<videoId>/1080p/index.m3u8" }
  ]
}
```

If the Lambda function throws, NestJS receives `response.FunctionError = 'Unhandled'` and throws `InternalServerErrorException`. BullMQ retries the job according to the `attempts` and `backoff` configured in `VideoService.requestTranscode()`.

---

## 8. Recommended Lambda Configuration

| Setting | Value | Reason |
|---|---|---|
| Runtime | `nodejs20.x` | LTS; matches dev environment |
| Memory | `3008 MB` | More memory = more vCPU; H.264 encoding is CPU-bound |
| Timeout | `900 s` (15 min) | Maximum allowed; long videos need it |
| Ephemeral storage | `10240 MB` | `/tmp` space for the raw video + HLS segments |
| Architecture | `x86_64` | `ffmpeg-static` ships an x86_64 binary |

### Cost estimate (us-east-1)

A 10-minute 1080p video typically takes ~3–5 minutes at 3008 MB:

- Compute: ~3 min × 3008 MB × $0.0000166667 per GB-sec ≈ **$0.15 per video**
- Requests: $0.0000002 per invocation ≈ negligible

---

## 9. Environment Variables Reference

### NestJS (`.env`)

| Variable | Required when | Description |
|---|---|---|
| `LAMBDA_FUNCTION_NAME` | Using `LambdaTranscodingStrategy` | Lambda function name or ARN |
| `LAMBDA_REGION` | Using `LambdaTranscodingStrategy` | AWS region where the function is deployed |
| `LAMBDA_ACCESS_KEY_ID` | Using `LambdaTranscodingStrategy` | IAM user key with `lambda:InvokeFunction` permission |
| `LAMBDA_SECRET_ACCESS_KEY` | Using `LambdaTranscodingStrategy` | IAM user secret |

### Lambda function (set via AWS Console or CLI)

| Variable | Description |
|---|---|
| `R2_ENDPOINT` | Cloudflare R2 S3-compatible endpoint |
| `R2_ACCESS_KEY_ID` | R2 API access key |
| `R2_SECRET_ACCESS_KEY` | R2 API secret key |
| `R2_BUCKET` | R2 bucket name (e.g. `diy-aws-bucket`) |
