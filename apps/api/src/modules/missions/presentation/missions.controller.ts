import {
  CreateMissionSchema,
  ListMissionsQuerySchema,
  UpdateMissionSchema,
  UuidSchema,
  type CreateMissionInput,
  type ListMissionsQuery,
  type UpdateMissionInput,
} from "@mindforge/core";
import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../../../shared/auth/current-user.decorator.js";
import type { RequestContext } from "../../../shared/auth/request-context.js";
import { zodPipe } from "../../../shared/validation/zod-validation.pipe.js";
import { CreateMission } from "../application/create-mission.js";
import { ParkMission, UnparkMission } from "../application/park-mission.js";
import { GetMission, ListMissions } from "../application/read-missions.js";
import { UpdateMission } from "../application/update-mission.js";
import { toMissionView, type MissionView } from "./mission.view.js";

/**
 * `/v1/missions` (§6). Thin by design: parse, delegate, map. Every rule lives in the
 * use cases, and every failure leaves here as a `DomainError` that the global filter
 * turns into `application/problem+json`.
 *
 * Ids are validated as uuids at the boundary. Without it a malformed id reaches
 * Postgres and comes back as a 500 from a driver-level cast error, rather than the
 * 422 it actually is.
 */
@Controller("missions")
export class MissionsController {
  constructor(
    private readonly createMission: CreateMission,
    private readonly updateMission: UpdateMission,
    private readonly parkMission: ParkMission,
    private readonly unparkMission: UnparkMission,
    private readonly listMissions: ListMissions,
    private readonly getMission: GetMission,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: RequestContext,
    @Query(zodPipe(ListMissionsQuerySchema)) query: ListMissionsQuery,
  ): Promise<{ missions: MissionView[] }> {
    const missions = await this.listMissions.execute(user.userId, query);
    // Wrapped in an object rather than returned as a bare array, so the response can
    // grow a cursor later without breaking every client that indexed into it.
    return { missions: missions.map(toMissionView) };
  }

  @Post()
  async create(
    @CurrentUser() user: RequestContext,
    @Body(zodPipe(CreateMissionSchema)) body: CreateMissionInput,
  ): Promise<MissionView> {
    return toMissionView(await this.createMission.execute(user.userId, body));
  }

  @Get(":id")
  async get(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
  ): Promise<MissionView> {
    return toMissionView(await this.getMission.execute(user.userId, id));
  }

  @Patch(":id")
  async update(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
    @Body(zodPipe(UpdateMissionSchema)) body: UpdateMissionInput,
  ): Promise<MissionView> {
    return toMissionView(await this.updateMission.execute(user.userId, id, body));
  }

  /**
   * POST rather than PATCH with a status field. Parking has its own rules and its own
   * failure (`mission-not-active`), and a status column the client can set to
   * anything would put those rules on the client's honour.
   */
  @Post(":id/park")
  async park(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
  ): Promise<MissionView> {
    return toMissionView(await this.parkMission.execute(user.userId, id));
  }

  @Post(":id/unpark")
  async unpark(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
  ): Promise<MissionView> {
    return toMissionView(await this.unparkMission.execute(user.userId, id));
  }
}
