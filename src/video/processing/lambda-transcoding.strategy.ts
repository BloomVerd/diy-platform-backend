import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { TranscodingResult, TranscodingStrategy } from './transcoding.strategy';

@Injectable()
export class LambdaTranscodingStrategy extends TranscodingStrategy {
  private readonly logger = new Logger(LambdaTranscodingStrategy.name);
  private readonly lambda: LambdaClient;
  private readonly functionName: string;

  constructor(private readonly configService: ConfigService) {
    super();
    this.lambda = new LambdaClient({
      region: this.configService.getOrThrow<string>('LAMBDA_REGION'),
      credentials: {
        accessKeyId: this.configService.getOrThrow<string>('LAMBDA_ACCESS_KEY_ID'),
        secretAccessKey: this.configService.getOrThrow<string>('LAMBDA_SECRET_ACCESS_KEY'),
      },
    });
    this.functionName = this.configService.getOrThrow<string>('LAMBDA_FUNCTION_NAME');
  }

  async transcode(
    videoId: string,
    objectKey: string,
    variants: string[],
  ): Promise<TranscodingResult> {
    this.logger.log(`Invoking Lambda for video ${videoId} (function: ${this.functionName})`);

    const response = await this.lambda.send(
      new InvokeCommand({
        FunctionName: this.functionName,
        InvocationType: 'RequestResponse', // synchronous — waits up to 15 min
        Payload: Buffer.from(JSON.stringify({ videoId, objectKey, variants })),
      }),
    );

    if (response.FunctionError) {
      const errorPayload = JSON.parse(Buffer.from(response.Payload!).toString());
      throw new InternalServerErrorException(
        `Lambda function error for video ${videoId}: ${errorPayload.errorMessage ?? JSON.stringify(errorPayload)}`,
      );
    }

    const result: TranscodingResult = JSON.parse(Buffer.from(response.Payload!).toString());
    this.logger.log(`Lambda transcoding complete for video ${videoId}`);
    return result;
  }
}
