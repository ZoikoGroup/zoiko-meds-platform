import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MedibaseService } from './medibase.service';
import { MatchQueryDto } from './dto/match-query.dto';
import { LookupIdentifierQuery } from './dto/lookup-identifier.query';

/**
 * MediBase™ public read surface. Returns governed medicine identities only —
 * suppressed entities and internal governance fields are never exposed here.
 */
@ApiTags('medibase')
@Controller('medibase')
export class MedibaseController {
  constructor(private readonly medibase: MedibaseService) {}

  @Get('match')
  @ApiOperation({ summary: 'Normalized, ranked medicine identity match' })
  match(@Query() query: MatchQueryDto) {
    return this.medibase.matchMedicines(query.q ?? '', {
      limit: query.limit,
      jurisdiction: query.jurisdiction,
      includeIdentifiers: query.includeIdentifiers,
    });
  }

  @Get('lookup')
  @ApiOperation({ summary: 'Resolve a medicine by an external identifier' })
  lookup(@Query() query: LookupIdentifierQuery) {
    return this.medibase.lookupByIdentifier(query.system, query.value);
  }

  @Get('meta/dictionary')
  @ApiOperation({ summary: 'MediBase data dictionary (schema contract)' })
  dictionary() {
    return this.medibase.dataDictionary();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a medicine identity by id (suppressed hidden)' })
  findOne(@Param('id') id: string) {
    return this.medibase.findById(id);
  }
}
