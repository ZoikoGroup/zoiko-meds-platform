import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SignalService } from './signal.service';

@ApiTags('signal')
@Controller('signal')
export class SignalController {
  constructor(private readonly signal: SignalService) {}

  @Get('aggregates')
  aggregates(
    @Query('medicineId') medicineId?: string,
    @Query('jurisdictionId') jurisdictionId?: string,
  ) {
    return this.signal.getAggregates({ medicineId, jurisdictionId });
  }
}
