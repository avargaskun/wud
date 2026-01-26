#!/bin/bash

################################################################################
# SCRIPT: setup_ecr_test.sh
# PURPOSE: Sets up a mock ECR environment for testing container updates.
#          1. Creates an ECR repository.
#          2. Pushes two versioned images (1.0.0 and 2.0.0).
#             * FORCES platform linux/amd64 for GitHub Actions compatibility.
#          3. Creates a restricted IAM user.
#          4. (Optional) Rotates Access Keys.
#
# USAGE:   ./setup_ecr_test.sh [options]
#
# OPTIONS:
#   --skip-keys   Skip the deletion and regeneration of AWS Access Keys.
#                 Useful for repeated runs where you want to keep existing credentials.
#
################################################################################

# --- CONFIGURATION VARIABLES ---
export AWS_REGION="${AWS_REGION:-us-west-2}"
export REPO_NAME="${REPO_NAME:-test-project}"
export IAM_USER_NAME="${IAM_USER_NAME:-ecr-test-robot}"
export POLICY_NAME="${POLICY_NAME:-ECRTestReadPolicy}"
# Target platform for the container image (matches GitHub Actions runners)
export TARGET_PLATFORM="linux/amd64"

# Set colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Check for arguments
SKIP_KEYS=false
for arg in "$@"; do
  if [ "$arg" == "--skip-keys" ]; then
    SKIP_KEYS=true
  fi
done

echo -e "${GREEN}--- STARTING ECR TEST ENVIRONMENT SETUP ---${NC}"

# --- STEP 1: GET ACCOUNT ID ---
echo "Retrieving AWS Account ID..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

if [ -z "$ACCOUNT_ID" ]; then
    echo "Error: Could not determine AWS Account ID. Please run 'aws configure'."
    exit 1
fi

echo "Using Account ID: $ACCOUNT_ID"
echo "Using Region: $AWS_REGION"

# --- STEP 2: CREATE ECR REPOSITORY ---
echo -e "\n${GREEN}Step 1: Creating ECR Repository '$REPO_NAME'...${NC}"
aws ecr create-repository --repository-name "$REPO_NAME" --region "$AWS_REGION" > /dev/null 2>&1 || echo "Repository likely already exists, proceeding..."

ECR_URI="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
REPO_URI="${ECR_URI}/${REPO_NAME}"

# --- STEP 3: AUTHENTICATE DOCKER ---
echo -e "\n${GREEN}Step 2: Authenticating Docker with ECR...${NC}"
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ECR_URI"

# --- STEP 4: PREPARE AND PUSH IMAGES (CROSS-PLATFORM) ---
echo -e "\n${GREEN}Step 3: pushing test images (v1.0.0 and v2.0.0)...${NC}"
echo -e "Targeting platform: ${CYAN}${TARGET_PLATFORM}${NC}"

# Pull the base image specifically for linux/amd64
# This prevents the "exec format error" or platform mismatch warnings in GitHub Actions
docker pull --platform "$TARGET_PLATFORM" nginx:alpine > /dev/null

# Tag and Push 1.0.0
echo "Pushing $REPO_NAME:1.0.0..."
docker tag nginx:alpine "$REPO_URI:1.0.0"
docker push "$REPO_URI:1.0.0"

# Tag and Push 2.0.0
echo "Pushing $REPO_NAME:2.0.0..."
docker tag nginx:alpine "$REPO_URI:2.0.0"
docker push "$REPO_URI:2.0.0"

# --- STEP 5: CREATE IAM USER ---
echo -e "\n${GREEN}Step 4: Creating IAM User '$IAM_USER_NAME'...${NC}"
aws iam create-user --user-name "$IAM_USER_NAME" > /dev/null 2>&1 || echo "User likely already exists, proceeding..."

# --- STEP 6: CREATE AND ATTACH POLICY ---
echo -e "\n${GREEN}Step 5: Creating and Attaching Least-Privilege Policy...${NC}"

cat <<EOF > ecr_test_policy.json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AllowAuth",
            "Effect": "Allow",
            "Action": "ecr:GetAuthorizationToken",
            "Resource": "*"
        },
        {
            "Sid": "AllowPull",
            "Effect": "Allow",
            "Action": [
                "ecr:BatchCheckLayerAvailability",
                "ecr:GetDownloadUrlForLayer",
                "ecr:BatchGetImage",
                "ecr:DescribeImages",
                "ecr:ListImages"
            ],
            "Resource": "arn:aws:ecr:${AWS_REGION}:${ACCOUNT_ID}:repository/${REPO_NAME}"
        }
    ]
}
EOF

POLICY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}"

# Try to create policy, ignore error if it exists
aws iam create-policy --policy-name "$POLICY_NAME" --policy-document file://ecr_test_policy.json > /dev/null 2>&1 || echo "Policy likely already exists."
aws iam attach-user-policy --user-name "$IAM_USER_NAME" --policy-arn "$POLICY_ARN"
rm ecr_test_policy.json

# --- STEP 7: ROTATE CREDENTIALS (CONDITIONAL) ---
CRED_FILE="ecr_test_credentials.json"

if [ "$SKIP_KEYS" = true ]; then
    echo -e "\n${YELLOW}Step 6: Skipping Key Rotation (--skip-keys argument detected).${NC}"
else
    echo -e "\n${GREEN}Step 6: Rotating Access Keys for '$IAM_USER_NAME'...${NC}"

    # 7a. List existing keys
    EXISTING_KEYS=$(aws iam list-access-keys --user-name "$IAM_USER_NAME" --query 'AccessKeyMetadata[*].AccessKeyId' --output text)

    # 7b. Loop through and delete them
    if [ "$EXISTING_KEYS" != "None" ] && [ -n "$EXISTING_KEYS" ]; then
        for key in $EXISTING_KEYS; do
            echo -e "${YELLOW}Deleting old key: $key${NC}"
            aws iam delete-access-key --user-name "$IAM_USER_NAME" --access-key-id "$key"
        done
    else
        echo "No existing keys found."
    fi

    # 7c. Create new key and save to file
    echo -e "Generating new key and saving to $CRED_FILE..."
    aws iam create-access-key --user-name "$IAM_USER_NAME" > "$CRED_FILE"
fi

# --- STEP 8: PARSE AND DISPLAY .ENV CONFIG ---

if [ "$SKIP_KEYS" = true ]; then
    echo -e "\n${YELLOW}NOTE: Credentials were not rotated. Use your existing values.${NC}"
    echo "AWS_REGION=${AWS_REGION}"
    echo "ECR_REGISTRY_URL=${ECR_URI}"
    echo "ECR_IMAGE_NAME=${REPO_NAME}"
else
    echo -e "\n${GREEN}Step 7: Parsing credentials...${NC}"

    # We use grep and awk to extract values from the JSON file
    ACCESS_KEY_ID=$(grep '"AccessKeyId"' "$CRED_FILE" | awk -F'"' '{print $4}')
    SECRET_ACCESS_KEY=$(grep '"SecretAccessKey"' "$CRED_FILE" | awk -F'"' '{print $4}')

    # Display the banner
    echo ""
    echo -e "${YELLOW}#################################################################${NC}"
    echo -e "${YELLOW}#           Use the following values in your .env file          #${NC}"
    echo -e "${YELLOW}#################################################################${NC}"
    echo ""
    echo "AWS_ACCESSKEY_ID=${ACCESS_KEY_ID}"
    echo "AWS_SECRET_ACCESSKEY=${SECRET_ACCESS_KEY}"
    echo "AWS_REGION=${AWS_REGION}"
    echo "ECR_REGISTRY_URL=${ECR_URI}"
    echo "ECR_IMAGE_NAME=${REPO_NAME}"
    echo ""
    echo -e "${YELLOW}#################################################################${NC}"
    echo ""
fi

echo -e "${GREEN}--- SETUP COMPLETE ---${NC}"