import { Controller, Get, Query, UseInterceptors } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AvailabilityService } from './availability.service';
import { GatewayTelemetryInterceptor } from '../admin/telemetry/gateway-telemetry.interceptor';

@ApiTags('availability')
@UseInterceptors(GatewayTelemetryInterceptor)
@Controller('availability')
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get()
  get(@Query('medicineId') medicineId: string) {
    return this.availability.getAvailability(medicineId);
  }
}
