import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PublicSearchQuery } from './dto/public-search.query';
import { SearchService } from './search.service';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  run(@Query() query: PublicSearchQuery) {
    return this.search.search(query);
  }
}
