import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UploadVideoDto {
  @ApiPropertyOptional({ description: 'Optional user-facing title' })
  @IsOptional()
  @IsString()
  title?: string;
}
