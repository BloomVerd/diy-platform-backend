import { Module } from '@nestjs/common';
import { S3Service } from './resources/services/s3.service';

@Module({
  imports: [],
  controllers: [],
  providers: [S3Service],
  exports: [S3Service],
})
export class FileStorageModule {}
