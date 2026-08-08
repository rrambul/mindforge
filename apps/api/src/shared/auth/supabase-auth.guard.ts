import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UnauthenticatedError } from "../errors/common-errors.js";
import { PROFILE_READER, type ProfileReader } from "./profile-reader.js";
import { IS_PUBLIC } from "./public.decorator.js";
import { attachRequestContext } from "./request-context.js";
import { TOKEN_VERIFIER, type TokenVerifier } from "./token-verifier.js";

interface RequestLike {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

/**
 * Applied globally, with `@Public()` as the opt-out (TECH-DESIGN.md §4).
 *
 * Its job is narrow: prove who is asking, then hand the rest of the request a
 * `RequestContext` it can trust. It performs no authorisation — that is Postgres'
 * job through RLS, which is why every repository read goes through
 * `UserScopedDb` rather than being filtered in TypeScript.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TOKEN_VERIFIER) private readonly tokens: TokenVerifier,
    @Inject(PROFILE_READER) private readonly profiles: ProfileReader,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Handler first, then class: a public controller can still protect one route.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestLike>();

    const token = bearerToken(request.headers["authorization"]);
    if (!token) throw new UnauthenticatedError("no bearer token");

    let userId: string;
    try {
      ({ userId } = await this.tokens.verify(token));
    } catch (cause) {
      // Collapsed on purpose. Expired, wrong issuer, bad signature, and
      // malformed are one outcome for the caller, and distinguishing them in the
      // response would be free reconnaissance. The reason reaches the log.
      throw new UnauthenticatedError(`token rejected: ${describe(cause)}`);
    }

    const profile = await this.profiles.findForAuth(userId);
    if (!profile) {
      // A validly-signed token for an account that no longer exists. Access
      // ends when the row does, not when the token expires — otherwise deleting
      // an account leaves up to an hour of usable credentials behind, and
      // account deletion (FR-A4) would be a promise the API does not keep.
      throw new UnauthenticatedError(`no profile for ${userId}`);
    }

    attachRequestContext(request, {
      userId: profile.userId,
      locale: profile.locale,
      contentLanguage: profile.contentLanguage,
      timezone: profile.timezone,
      weekStartsOn: profile.weekStartsOn,
    });
    return true;
  }
}

/**
 * Tolerant of the casing and spacing that real clients send, strict about the
 * scheme. A header arriving twice is rejected rather than resolved: two
 * Authorization headers is not something a legitimate client does.
 */
function bearerToken(header: string | string[] | undefined): string | null {
  if (typeof header !== "string") return null;

  const match = /^Bearer[ \t]+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
