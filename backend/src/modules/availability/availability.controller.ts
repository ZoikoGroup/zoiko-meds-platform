import { Controller, Get, Query, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AvailabilityService } from './availability.service';
import { GatewayTelemetryInterceptor } from '../admin/telemetry/gateway-telemetry.interceptor';

@ApiTags('availability')
@UseInterceptors(GatewayTelemetryInterceptor)
@Controller('availability')
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get()
  @ApiOperation({
    summary: 'Governed availability confidence for a medicine',
    description: [
      'The ZoikoAvail™ answer to "can a patient get this medicine near here".',
      '',
      'Returns a confidence band per verified pharmacy — high, moderate, low or',
      'unknown — never an exact stock count. No pharmacy reports a quantity to',
      'this API and none is stored, so there is none to return. A band is a',
      'statement about how much the platform trusts a signal, not a promise that',
      'the shelf holds anything.',
      '',
      'Only pharmacies that pass the patient-visibility rule appear: verified,',
      'participating, and on a commercial classification that means somebody has',
      'taken responsibility for what the record says. Suppressed signals are',
      'excluded.',
      '',
      'Unauthenticated. Rate limited in common with the rest of the governed API.',
    ].join('\n'),
  })
  @ApiQuery({
    name: 'medicineId',
    required: true,
    description: 'MediBase medicine identity id. Resolve one with GET /medibase/match.',
    example: 'cmf1a2b3c4d5e6f7g8h9',
  })
  @ApiResponse({
    status: 200,
    description:
      'Availability for the medicine, per visible pharmacy. An empty list means no verified pharmacy near the caller reports it — which is an answer, not a failure.',
  })
  @ApiResponse({ status: 404, description: 'No such medicine identity in MediBase.' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded.' })
  get(@Query('medicineId') medicineId: string) {
    return this.availability.getAvailability(medicineId);
  }
}
