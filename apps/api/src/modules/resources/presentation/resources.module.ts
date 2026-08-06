import { Module } from "@nestjs/common";
import { LINK_TARGETS } from "../application/link-targets.port.js";
import {
  AbandonResource,
  AddResource,
  CaptureResource,
  EditResource,
  FinishResource,
  ListResources,
  MarkProgress,
  ReadResourceLinks,
  SetResourceLinks,
} from "../application/resource.use-cases.js";
import { URL_METADATA } from "../application/url-metadata.port.js";
import { RESOURCE_REPOSITORY } from "../domain/resource.repository.js";
import { HtmlUrlMetadataReader } from "../infrastructure/html-url-metadata.reader.js";
import { PrismaLinkTargetReader } from "../infrastructure/prisma-link-target.reader.js";
import { PrismaResourceRepository } from "../infrastructure/prisma-resource.repository.js";
import { ResourcesController } from "./resources.controller.js";

/**
 * `CaptureResource` is exported because the teach agent surfaces sources it finds (FR-T8) and the
 * browser extension (M9) captures too — both through this command rather than a second write path.
 */
@Module({
  controllers: [ResourcesController],
  providers: [
    CaptureResource,
    AddResource,
    EditResource,
    MarkProgress,
    FinishResource,
    AbandonResource,
    ListResources,
    SetResourceLinks,
    ReadResourceLinks,
    { provide: RESOURCE_REPOSITORY, useClass: PrismaResourceRepository },
    { provide: URL_METADATA, useClass: HtmlUrlMetadataReader },
    { provide: LINK_TARGETS, useClass: PrismaLinkTargetReader },
  ],
  exports: [CaptureResource, ListResources],
})
export class ResourcesModule {}
