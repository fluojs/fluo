import {
  Controller,
  FromFiles,
  Post,
  RequestDto,
  type FrameworkRequestFile,
} from '@fluojs/http';

export class UploadAssetsDto {
  @FromFiles('attachments')
  attachments: readonly FrameworkRequestFile[] = [];
}

@Controller('/uploads')
export class UploadController {
  @Post('/')
  @RequestDto(UploadAssetsDto)
  upload(input: UploadAssetsDto): { filenames: readonly string[]; uploaded: number } {
    return {
      filenames: input.attachments.map((file) => file.originalname),
      uploaded: input.attachments.length,
    };
  }
}
