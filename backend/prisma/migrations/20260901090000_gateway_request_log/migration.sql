-- One row per request served by the ZoikoAvail(TM) governed API surface
-- (availability | medibase | signal). Backs the real uptime/latency/
-- throughput/per-endpoint numbers on the admin ZoikoAvail console, which
-- previously rendered fixed fixtures with nothing behind them (MSA-36).
CREATE TABLE "GatewayRequestLog" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GatewayRequestLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GatewayRequestLog_scope_createdAt_idx" ON "GatewayRequestLog"("scope", "createdAt");

CREATE INDEX "GatewayRequestLog_route_createdAt_idx" ON "GatewayRequestLog"("route", "createdAt");

CREATE INDEX "GatewayRequestLog_statusCode_idx" ON "GatewayRequestLog"("statusCode");
