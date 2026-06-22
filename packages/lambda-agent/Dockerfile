# Lambda Container Image for OpenClaw Agent Runtime
# Uses AWS Lambda Node.js 22 base image (arm64)
# OpenClaw is loaded via extensionAPI.js (file:// import to bypass exports map)

# Stage 1: Build lambda-agent package
FROM --platform=linux/arm64 public.ecr.aws/lambda/nodejs:22 AS builder

WORKDIR /build

# Copy workspace root files for workspace resolution
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src/ packages/shared/src/
COPY packages/lambda-agent/package.json packages/lambda-agent/tsconfig.json packages/lambda-agent/
COPY packages/lambda-agent/src/ packages/lambda-agent/src/

RUN npm pkg delete scripts.prepare && \
    npm ci
RUN npm run build --workspace=packages/shared --workspace=packages/lambda-agent

# Stage 2: Lambda runtime
FROM --platform=linux/arm64 public.ecr.aws/lambda/nodejs:22

# Install git (required by OpenClaw's npm dependencies)
RUN dnf install -y git && dnf clean all

# Install OpenClaw FIRST — gets all its transitive dependencies cleanly
ARG OPENCLAW_VERSION=2026.2.13
RUN cd ${LAMBDA_TASK_ROOT} && \
    npm init -y && \
    npm install openclaw@${OPENCLAW_VERSION} && \
    npm cache clean --force

# Install @aws-sdk/lib-dynamodb alongside OpenClaw so Node resolves the
# client-dynamodb peer from the Lambda runtime's built-in SDK layer.
# npm will also pull in the @smithy/* transitive deps that @aws-sdk/lib-dynamodb
# expects as separate packages (the runtime's @aws-sdk/* bundle them internally).
RUN cd ${LAMBDA_TASK_ROOT} && \
    npm install @aws-sdk/lib-dynamodb @aws-sdk/util-dynamodb && \
    npm cache clean --force

# Copy lambda-agent compiled output
COPY --from=builder /build/packages/lambda-agent/dist/ ${LAMBDA_TASK_ROOT}/dist/

# Copy shared package into node_modules (lambda-agent depends on it)
COPY --from=builder /build/packages/shared/dist/ ${LAMBDA_TASK_ROOT}/node_modules/@serverless-openclaw/shared/dist/
COPY --from=builder /build/packages/shared/package.json ${LAMBDA_TASK_ROOT}/node_modules/@serverless-openclaw/shared/

# Set HOME to /tmp so OpenClaw config/sessions go to writable directory
ENV HOME=/tmp

# Lambda handler entry point
CMD ["dist/index.handler"]
