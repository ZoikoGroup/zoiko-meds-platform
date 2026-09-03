import { Controller, Get, Param, Query, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { MedibaseService } from './medibase.service';
import { MatchQueryDto } from './dto/match-query.dto';
import { LookupIdentifierQuery } from './dto/lookup-identifier.query';
import { GatewayTelemetryInterceptor } from '../admin/telemetry/gateway-telemetry.interceptor';

/**
 * MediBase™ public read surface. Returns governed medicine identities only —
 * suppressed entities and internal governance fields are never exposed here.
 */
@ApiTags('medibase')
@UseInterceptors(GatewayTelemetryInterceptor)
@Controller('medibase')
export class MedibaseController {
  constructor(private readonly medibase: MedibaseService) {}

  @Get('match')
  @ApiOperation({
    summary: 'Normalized, ranked medicine identity match',
    description:
      'Resolve free text — a brand, a generic, a misspelling — into governed MediBase identities, ranked. Variant expansion runs first, then a typo-tolerant fuzzy pass when nothing matches exactly. Suppressed identities are never returned. Unauthenticated.',
  })
  @ApiResponse({
    status: 200,
    description: 'Ranked identities, best first. An empty array means nothing scored above the floor.',
  })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded.' })
  match(@Query() query: MatchQueryDto) {
    return this.medibase.matchMedicines(query.q ?? '', {
      limit: query.limit,
      jurisdiction: query.jurisdiction,
      includeIdentifiers: query.includeIdentifiers,
    });
  }

  @Get('lookup')
  @ApiOperation({
    summary: 'Resolve a medicine by an external identifier',
    description:
      'Exact lookup by a coding system and value, for integrating against an identifier you already hold rather than a name. Unauthenticated.',
  })
  @ApiResponse({ status: 200, description: 'The matching identity.' })
  @ApiResponse({ status: 404, description: 'No governed identity carries that identifier.' })
  lookup(@Query() query: LookupIdentifierQuery) {
    return this.medibase.lookupByIdentifier(query.system, query.value);
  }

  @Get('meta/dictionary')
  @ApiOperation({
    summary: 'MediBase data dictionary (schema contract)',
    description:
      'The field-by-field contract for everything MediBase returns. Read this before integrating: it is the stable description of the shape, so a client can be written against it rather than against a sample response. Unauthenticated.',
  })
  @ApiResponse({ status: 200, description: 'Field names, types and meanings.' })
  dictionary() {
    return this.medibase.dataDictionary();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Fetch a medicine identity by id',
    description:
      'One governed identity in full. A suppressed identity answers 404 rather than returning a record marked hidden — the caller has no business knowing it exists. Unauthenticated.',
  })
  @ApiParam({
    name: 'id',
    description: 'MediBase identity id, as returned by /medibase/match.',
    example: 'cmf1a2b3c4d5e6f7g8h9',
  })
  @ApiResponse({ status: 200, description: 'The governed medicine identity.' })
  @ApiResponse({ status: 404, description: 'No such identity, or it is suppressed.' })
  findOne(@Param('id') id: string) {
    return this.medibase.findById(id);
  }
}
