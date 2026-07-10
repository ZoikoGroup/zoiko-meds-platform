import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EnterpriseService } from './enterprise.service';
import { CreateInquiryDto } from './dto/create-inquiry.dto';

@ApiTags('enterprise')
@Controller('enterprise')
export class EnterpriseController {
  constructor(private readonly enterprise: EnterpriseService) {}

  @Post('inquiries')
  create(@Body() dto: CreateInquiryDto) {
    return this.enterprise.createInquiry(dto);
  }
}
