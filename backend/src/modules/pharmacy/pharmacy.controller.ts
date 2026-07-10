import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PharmacyService } from './pharmacy.service';

@ApiTags('pharmacy')
@Controller('pharmacies')
export class PharmacyController {
  constructor(private readonly pharmacy: PharmacyService) {}

  @Get()
  list() {
    return this.pharmacy.listVerified();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.pharmacy.findById(id);
  }
}
