import { Module } from '@nestjs/common';
import { SavedMedicineLinkService } from './saved-medicine-link.service';

/**
 * Standalone so both the patient portal (which creates name-only saves) and the
 * pharmacy portal (which brings medicines into the catalog) can depend on it
 * without importing each other.
 */
@Module({
  providers: [SavedMedicineLinkService],
  exports: [SavedMedicineLinkService],
})
export class SavedMedicineLinkModule {}
