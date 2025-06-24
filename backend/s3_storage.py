# s3_storage.py - AWS S3 storage service for Time Capsule images
import os
import boto3
import logging
from typing import Optional, Tuple
from botocore.exceptions import NoCredentialsError, ClientError
from botocore.config import Config
import io
from PIL import Image

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class S3StorageService:
    def __init__(self):
        """
        Initialize S3 storage service
        Uses environment variables for AWS credentials and configuration
        """
        self.bucket_name = os.environ.get('AWS_S3_BUCKET_NAME', 'ethereum-time-capsule-storage')
        self.region = os.environ.get('AWS_REGION', 'us-east-1')        # Initialize S3 client
        try:
            # More explicit configuration to handle signature issues
            config = Config(
                signature_version='s3v4',
                s3={
                    'addressing_style': 'virtual'
                },
                retries={
                    'max_attempts': 3,
                    'mode': 'adaptive'
                }
            )
            
            # Get credentials from environment with explicit handling
            access_key = os.environ.get('AWS_ACCESS_KEY_ID')
            secret_key = os.environ.get('AWS_SECRET_ACCESS_KEY')
            
            if access_key and secret_key:
                # Handle potential URL encoding issues in secret key
                import urllib.parse
                # The secret key might have special characters that need proper handling
                # Don't URL decode since boto3 should handle this properly, but ensure clean credentials
                try:
                    # Use session-based approach for better credential handling
                    session = boto3.Session(
                        aws_access_key_id=access_key.strip(),
                        aws_secret_access_key=secret_key.strip(),
                        region_name=self.region
                    )
                    self.s3_client = session.client('s3', config=config)
                except Exception as session_error:
                    logger.warning(f"Session-based client failed: {session_error}, trying direct client")
                    # Fallback to direct client
                    self.s3_client = boto3.client(
                        's3',
                        aws_access_key_id=access_key.strip(),
                        aws_secret_access_key=secret_key.strip(),
                        region_name=self.region,
                        config=config
                    )
            else:
                # Fallback to default credential chain
                self.s3_client = boto3.client('s3', region_name=self.region, config=config)
            
            # Skip bucket existence check to avoid permission issues
            # We'll assume the bucket exists and handle errors gracefully during operations
            logger.info(f"S3 storage service initialized for bucket: {self.bucket_name}")
            
        except NoCredentialsError:
            logger.warning("AWS credentials not found. S3 storage will be disabled.")
            self.s3_client = None
        except Exception as e:
            logger.error(f"Failed to initialize S3 client: {e}")
            self.s3_client = None
    
    def _ensure_bucket_exists(self):
        """Create S3 bucket if it doesn't exist"""
        try:
            # Check if bucket exists
            self.s3_client.head_bucket(Bucket=self.bucket_name)
            logger.info(f"S3 bucket {self.bucket_name} exists")
        except ClientError as e:
            error_code = e.response['Error']['Code']
            if error_code == '404':
                # Bucket doesn't exist, create it
                try:
                    if self.region == 'us-east-1':
                        # us-east-1 doesn't need LocationConstraint
                        self.s3_client.create_bucket(Bucket=self.bucket_name)
                    else:
                        self.s3_client.create_bucket(
                            Bucket=self.bucket_name,
                            CreateBucketConfiguration={'LocationConstraint': self.region}
                        )
                    
                    # Set bucket policy for public read access to images
                    self._set_bucket_policy()
                    logger.info(f"Created S3 bucket: {self.bucket_name}")
                except Exception as create_error:
                    logger.error(f"Failed to create S3 bucket: {create_error}")
                    raise
            else:
                logger.error(f"Error checking S3 bucket: {e}")
                raise
    
    def _set_bucket_policy(self):
        """Set bucket policy to allow public read access to images"""
        policy = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Sid": "PublicReadGetObject",
                    "Effect": "Allow",
                    "Principal": "*",
                    "Action": "s3:GetObject",
                    "Resource": f"arn:aws:s3:::{self.bucket_name}/images/*"
                }
            ]
        }
        
        try:
            import json
            self.s3_client.put_bucket_policy(
                Bucket=self.bucket_name,
                Policy=json.dumps(policy)
            )
            logger.info("Set S3 bucket policy for public image access")
        except Exception as e:
            logger.warning(f"Could not set bucket policy (images may not be publicly accessible): {e}")
    
    def is_available(self) -> bool:
        """Check if S3 storage is available"""
        return self.s3_client is not None
    
    def upload_image(self, image_data: bytes, filename: str, content_type: str = 'image/png') -> Optional[str]:
        """
        Upload image to S3
        
        Args:
            image_data: Image data as bytes
            filename: Filename for the image
            content_type: MIME type of the image
            
        Returns:
            Public URL of the uploaded image or None if failed
        """
        if not self.is_available():
            logger.error("S3 service not available")
            return None
        
        try:
            # Upload to images/ prefix for organization
            s3_key = f"images/{filename}"
            
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=s3_key,
                Body=image_data,
                ContentType=content_type,
                CacheControl='max-age=31536000',  # 1 year cache
                Metadata={
                    'uploaded_by': 'ethereum-time-capsule',
                    'upload_time': str(int(os.times().system))
                }
            )
            
            # Return public URL
            public_url = f"https://{self.bucket_name}.s3.{self.region}.amazonaws.com/{s3_key}"
            logger.info(f"Uploaded image to S3: {public_url}")
            return public_url
            
        except Exception as e:
            logger.error(f"Failed to upload image to S3: {e}")
            return None
    
    def upload_pixelated_image(self, cid: str, image_data: bytes) -> Optional[str]:
        """
        Upload pixelated preview image to S3
        
        Args:
            cid: IPFS CID to use as filename
            image_data: Pixelated image data as bytes
            
        Returns:
            Public URL of the uploaded pixelated image
        """
        filename = f"pixelated_{cid}.png"
        return self.upload_image(image_data, filename, 'image/png')
    
    def upload_original_image(self, cid: str, image_data: bytes) -> Optional[str]:
        """
        Upload original/decrypted image to S3
        
        Args:
            cid: IPFS CID to use as filename
            image_data: Original image data as bytes
            
        Returns:
            Public URL of the uploaded original image
        """
        filename = f"original_{cid}.png"
        return self.upload_image(image_data, filename, 'image/png')
    
    def get_pixelated_url(self, cid: str, expiration: int = 3600) -> str:
        """
        Generate a pre-signed URL for a pixelated image
        
        Args:
            cid: IPFS CID
            expiration: URL expiration time in seconds (default: 1 hour)
            
        Returns:
            Pre-signed S3 URL for the pixelated image
        """
        if not self.is_available():
            return None
            
        try:
            filename = f"pixelated_{cid}.png"
            s3_key = f"images/{filename}"
            
            url = self.s3_client.generate_presigned_url(
                'get_object',
                Params={'Bucket': self.bucket_name, 'Key': s3_key},
                ExpiresIn=expiration            )
            return url
        except Exception as e:
            logger.error(f"Failed to generate pre-signed URL for {cid}: {e}")
            return None

    def get_original_url(self, cid: str, expiration: int = 3600) -> str:
        """
        Generate a pre-signed URL for an original image
        
        Args:
            cid: IPFS CID
            expiration: URL expiration time in seconds (default: 1 hour)
            
        Returns:
            Pre-signed S3 URL for the original image
        """
        if not self.is_available():
            return None
            
        try:
            filename = f"original_{cid}.png"
            s3_key = f"images/{filename}"
            
            url = self.s3_client.generate_presigned_url(
                'get_object',
                Params={'Bucket': self.bucket_name, 'Key': s3_key},
                ExpiresIn=expiration
            )
            return url
        except Exception as e:
            logger.error(f"Failed to generate pre-signed URL for {cid}: {e}")
            return None

    def image_exists(self, filename: str) -> bool:
        """
        Check if an image exists in S3
        
        Args:
            filename: Name of the image file
            
        Returns:
            True if image exists, False otherwise
        """
        if not self.is_available():
            return False
            
        try:
            s3_key = f"images/{filename}"
            self.s3_client.head_object(Bucket=self.bucket_name, Key=s3_key)
            return True
        except ClientError:
            return False

    def pixelated_exists(self, cid: str) -> bool:
        """Check if pixelated image exists in S3"""
        if not self.is_available():
            return False
            
        try:
            s3_key = f"pixelated/{cid}.png"
            self.s3_client.head_object(Bucket=self.bucket_name, Key=s3_key)
            return True
        except ClientError:            return False

    def download_image(self, filename: str) -> Optional[bytes]:
        """
        Download image from S3
        
        Args:
            filename: Name of the image file
            
        Returns:
            Image data as bytes or None if failed
        """
        if not self.is_available():
            return None
            
        try:
            s3_key = f"images/{filename}"
            response = self.s3_client.get_object(Bucket=self.bucket_name, Key=s3_key)
            return response['Body'].read()
        except Exception as e:
            logger.error(f"Failed to download image from S3: {e}")
            return None

    def download_pixelated_image(self, cid: str) -> Optional[bytes]:
        """
        Download pixelated image from S3
        
        Args:
            cid: IPFS CID for the image
            
        Returns:
            Pixelated image data as bytes or None if failed
        """
        if not self.is_available():
            return None
            
        try:
            # Pixelated images are stored as pixelated/{cid}.png in S3
            s3_key = f"pixelated/{cid}.png"
            response = self.s3_client.get_object(Bucket=self.bucket_name, Key=s3_key)
            return response['Body'].read()
        except Exception as e:
            logger.error(f"Failed to download image from S3: {e}")
            return None
    
    def generate_and_upload_pixelated(self, cid: str, original_image_data: bytes) -> Optional[str]:
        """
        Generate pixelated version of an image and upload to S3
        
        Args:
            cid: IPFS CID for the image
            original_image_data: Original image data as bytes
            
        Returns:
            Public URL of the uploaded pixelated image or None if failed
        """
        try:
            # Import pixelate function (assuming it exists in the main app)
            import sys
            import os
            sys.path.append(os.path.dirname(os.path.dirname(__file__)))
            from app import pixelate
            
            # Open image and create pixelated version
            pil_image = Image.open(io.BytesIO(original_image_data))
            pixelated_image = pixelate(pil_image)
            
            # Convert to bytes
            buf = io.BytesIO()
            pixelated_image.save(buf, format="PNG")
            pixelated_data = buf.getvalue()
            
            # Upload to S3
            return self.upload_pixelated_image(cid, pixelated_data)
            
        except Exception as e:
            logger.error(f"Failed to generate and upload pixelated image: {e}")
            return None

# Global instance
try:
    s3_storage = S3StorageService()
    logger.info("Global S3 storage instance created successfully")
except Exception as e:
    logger.error(f"Failed to create global S3 storage instance: {e}")
    s3_storage = None
