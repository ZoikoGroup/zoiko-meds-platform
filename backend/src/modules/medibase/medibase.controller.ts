import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { MedibaseService } from './medibase.service';

@ApiTags('medibase')
@Controller('medibase')
export class MedibaseController {
  constructor(private readonly medibase: MedibaseService) {}

  @Get('match')
  match(@Query('q') q = '', @Query('limit') limit?: string) {
    return this.medibase.matchMedicines(q, limit ? Number(limit) : undefined);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.medibase.findById(id);
  }
}
