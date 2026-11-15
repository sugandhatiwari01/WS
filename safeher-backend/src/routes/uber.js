
const express = require("express");
const crypto = require("crypto");
const { body, validationResult } = require("express-validator");

const { requireAuth, requireRole } = require("../middleware/auth");
const User = require("../models/User");
const Contact = require("../models/Contact");
const { sendSms } = require("./notify");

const router = express.Router();

// ======================================================
// CONFIGURATION
// ======================================================

const UBER_CLIENT_ID = process.env.UBER_CLIENT_ID;
const UBER_CLIENT_SECRET = process.env.UBER_CLIENT_SECRET;

const UBER_REDIRECT_URI =
  process.env.UBER_REDIRECT_URI ||
  "http://localhost:3000/api/uber/callback";

const UBER_AUTH_URL = "https://auth.uber.com/oauth/v2/authorize";
const UBER_TOKEN_URL = "https://auth.uber.com/oauth/v2/token";
const UBER_API_URL = "https://api.uber.com/v1.2";

const UBER_DEMO_MODE = process.env.UBER_DEMO_MODE !== "false";

const UBER_SCOPES = (
  process.env.UBER_SCOPES ||
  "ride_request.ride_booking offline_access"
).trim();

const STATE_SECRET =
  process.env.UBER_OAUTH_STATE_SECRET || process.env.JWT_SECRET;

// ======================================================
// COMMON HELPERS
// ======================================================

function validate(req, res, next) {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: errors.array()[0].msg
    });
  }

  next();
}

function validateConfiguration() {
  if (!UBER_CLIENT_ID || !UBER_CLIENT_SECRET) {
    throw new Error("Uber client credentials are not configured.");
  }

  if (!STATE_SECRET) {
    throw new Error(
      "UBER_OAUTH_STATE_SECRET or JWT_SECRET must be configured."
    );
  }

  if (!UBER_REDIRECT_URI) {
    throw new Error("UBER_REDIRECT_URI is missing.");
  }
}

function createOAuthState(userId) {
  if (!STATE_SECRET) {
    throw new Error("OAuth state signing secret is missing.");
  }

  const payload = {
    userId: String(userId),
    nonce: crypto.randomUUID(),
    exp: Date.now() + 10 * 60 * 1000
  };

  const encoded = Buffer.from(JSON.stringify(payload)).toString(
    "base64url"
  );

  const signature = crypto
    .createHmac("sha256", STATE_SECRET)
    .update(encoded)
    .digest("base64url");

  return `${encoded}.${signature}`;
}

function verifyOAuthState(state) {
  if (!state || !STATE_SECRET) {
    throw new Error("Missing OAuth state.");
  }

  const parts = state.split(".");

  if (parts.length !== 2) {
    throw new Error("Invalid OAuth state format.");
  }

  const [encoded, signature] = parts;

  const expectedSignature = crypto
    .createHmac("sha256", STATE_SECRET)
    .update(encoded)
    .digest();

  let receivedSignature;

  try {
    receivedSignature = Buffer.from(signature, "base64url");
  } catch {
    throw new Error("Invalid OAuth state signature.");
  }

  if (
    receivedSignature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(receivedSignature, expectedSignature)
  ) {
    throw new Error("OAuth state verification failed.");
  }

  let payload;

  try {
    payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8")
    );
  } catch {
    throw new Error("Invalid OAuth state payload.");
  }

  if (!payload.userId || !payload.nonce || payload.exp < Date.now()) {
    throw new Error("OAuth state expired or invalid.");
  }

  return payload;
}

async function exchangeAuthorizationCode(code) {
  const params = new URLSearchParams({
    client_id: UBER_CLIENT_ID,
    client_secret: UBER_CLIENT_SECRET,
    grant_type: "authorization_code",
    redirect_uri: UBER_REDIRECT_URI,
    code
  });

  const response = await fetch(UBER_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: params
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error_description ||
      data.error ||
      `Uber token exchange failed (${response.status}).`
    );
  }

  if (!data.access_token) {
    throw new Error("Uber did not return an access token.");
  }

  return data;
}

async function refreshUberToken(user) {
  if (!user.uberRefreshToken) {
    throw new Error("Uber refresh token is unavailable. Reconnect Uber.");
  }

  const params = new URLSearchParams({
    client_id: UBER_CLIENT_ID,
    client_secret: UBER_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: user.uberRefreshToken
  });

  const response = await fetch(UBER_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: params
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.access_token) {
    throw new Error(
      data.error_description ||
      data.error ||
      "Unable to refresh Uber access token."
    );
  }

  user.uberAccessToken = data.access_token;

  if (data.refresh_token) {
    user.uberRefreshToken = data.refresh_token;
  }

  await user.save();

  return user.uberAccessToken;
}

async function uberRequest(user, endpoint, options = {}) {
  let response = await fetch(`${UBER_API_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${user.uberAccessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers || {})
    }
  });

  if (response.status === 401 && user.uberRefreshToken) {
    await refreshUberToken(user);

    response = await fetch(`${UBER_API_URL}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${user.uberAccessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(options.headers || {})
      }
    });
  }

  return response;
}

function formatUberRide(data) {
  return {
    service: `Uber ${data.vehicle?.make || "Cab"}`,
    status: data.status || "unknown",

    driverName: data.driver?.name || "Uber Driver",
    driverPhone: data.driver?.phone_number || "",
    driverRating: data.driver?.rating
      ? String(data.driver.rating)
      : "",

    vehicle:
      `${data.vehicle?.make || ""} ${data.vehicle?.model || ""}`.trim() ||
      "Uber Vehicle",

    plate: data.vehicle?.license_plate || "",
    tripId: data.request_id || "",

    etaMinutes: data.eta || data.destination?.eta || null,

    pickup: data.pickup?.address || "",
    destination: data.destination?.address || "",

    currentLatitude: data.location?.latitude ?? null,
    currentLongitude: data.location?.longitude ?? null
  };
}

function demoRide() {
  return {
    service: "Uber Premier (DEMO)",
    status: "in_progress",
    driverName: "Demo Driver",
    driverPhone: "",
    driverRating: "4.92",
    vehicle: "Demo Toyota Innova",
    plate: "DEMO-1234",
    tripId: `DEMO-${Date.now()}`,
    destination: "Demo Destination",
    etaMinutes: 18,
    currentLatitude: 28.6139,
    currentLongitude: 77.209
  };
}

// ======================================================
// PUBLIC UBER OAUTH CALLBACK
// IMPORTANT: Must be BEFORE router.use(requireAuth)
// ======================================================

router.get("/callback", async (req, res) => {
  try {
    const { code, error, error_description, state } = req.query;

    if (error) {
      return res.status(400).json({
        success: false,
        error,
        message: error_description || "Uber authorization was denied."
      });
    }

    if (!code || typeof code !== "string") {
      return res.status(400).json({
        success: false,
        error: "AUTHORIZATION_CODE_MISSING"
      });
    }

    // Verify the signed state and identify the initiating user.
    const statePayload = verifyOAuthState(state);

    const user = await User.findById(statePayload.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "USER_NOT_FOUND"
      });
    }

    // DEMO MODE
    if (code.startsWith("mock_")) {
      if (!UBER_DEMO_MODE) {
        return res.status(400).json({
          success: false,
          error: "DEMO_MODE_DISABLED"
        });
      }

      user.uberAccessToken = `demo_access_token_${Date.now()}`;
      user.uberRefreshToken = `demo_refresh_token_${Date.now()}`;
      user.uberConnectedAt = new Date();

      await user.save();

      return res.json({
        success: true,
        message: "Uber connected successfully in Demo Mode."
      });
    }

    // LIVE TOKEN EXCHANGE
    validateConfiguration();

    const tokenData = await exchangeAuthorizationCode(code);

    user.uberAccessToken = tokenData.access_token;
    user.uberRefreshToken = tokenData.refresh_token || "";
    user.uberConnectedAt = new Date();

    await user.save();

    return res.json({
      success: true,
      message: "Uber account connected successfully.",
      expiresIn: tokenData.expires_in,
      scope: tokenData.scope
    });

  } catch (error) {
    console.error("Uber OAuth callback error:", error.message);

    return res.status(400).json({
      success: false,
      error: error.message || "Uber authorization failed."
    });
  }
});

// ======================================================
// PROTECT ALL REMAINING ENDPOINTS
// ======================================================

router.use(requireAuth, requireRole("user"));

// ======================================================
// GET /api/uber/status
// Check Uber configuration and connection
// ======================================================

router.get("/status", async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);

    res.json({
      configured: Boolean(UBER_CLIENT_ID && UBER_CLIENT_SECRET),
      demoMode: UBER_DEMO_MODE,
      connected: Boolean(user?.uberAccessToken),
      connectedAt: user?.uberConnectedAt || null
    });

  } catch (error) {
    next(error);
  }
});

// ======================================================
// GET /api/uber/auth-url
// Generate Uber authorization URL
// ======================================================

router.get("/auth-url", async (req, res) => {
  try {
    if (!STATE_SECRET) {
      return res.status(503).json({
        error: "OAUTH_STATE_SECRET_MISSING",
        message: "Configure UBER_OAUTH_STATE_SECRET or JWT_SECRET."
      });
    }

    const state = createOAuthState(req.user._id);

    // Demo mode: simulate OAuth callback without contacting Uber.
    if (!UBER_CLIENT_ID && UBER_DEMO_MODE) {
      const demoUrl = new URL(UBER_REDIRECT_URI);

      demoUrl.searchParams.set(
        "code",
        `mock_${crypto.randomUUID()}`
      );

      demoUrl.searchParams.set("state", state);

      return res.json({
        url: demoUrl.toString(),
        demoMode: true
      });
    }

    if (!UBER_CLIENT_ID || !UBER_CLIENT_SECRET) {
      return res.status(503).json({
        error: "UBER_NOT_CONFIGURED",
        message: "Configure UBER_CLIENT_ID and UBER_CLIENT_SECRET."
      });
    }

    const params = new URLSearchParams({
      client_id: UBER_CLIENT_ID,
      response_type: "code",
      redirect_uri: UBER_REDIRECT_URI,
      scope: UBER_SCOPES,
      state
    });

    const url = `${UBER_AUTH_URL}?${params.toString()}`;

    res.json({
      url,
      demoMode: false
    });

  } catch (error) {
    console.error("Uber auth URL error:", error.message);

    res.status(500).json({
      error: "Unable to generate Uber authorization URL."
    });
  }
});

// ======================================================
// POST /api/uber/exchange-token
// Legacy/manual authorization code exchange
// ======================================================

router.post(
  "/exchange-token",
  body("code").isString().trim().notEmpty(),
  validate,
  async (req, res, next) => {
    try {
      const { code } = req.body;

      const user = await User.findById(req.user._id);

      if (!user) {
        return res.status(404).json({
          error: "User not found."
        });
      }

      if (code.startsWith("mock_") && UBER_DEMO_MODE) {
        user.uberAccessToken = `demo_access_token_${Date.now()}`;
        user.uberRefreshToken = `demo_refresh_token_${Date.now()}`;
        user.uberConnectedAt = new Date();

        await user.save();

        return res.json({
          ok: true,
          message: "Uber connected successfully (Demo Mode)."
        });
      }

      validateConfiguration();

      const tokenData = await exchangeAuthorizationCode(code);

      user.uberAccessToken = tokenData.access_token;
      user.uberRefreshToken = tokenData.refresh_token || "";
      user.uberConnectedAt = new Date();

      await user.save();

      res.json({
        ok: true,
        message: "Uber connected successfully.",
        expiresIn: tokenData.expires_in
      });

    } catch (error) {
      next(error);
    }
  }
);

// ======================================================
// GET /api/uber/current-ride
// Fetch currently active Uber trip
// ======================================================

router.get("/current-ride", async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user?.uberAccessToken) {
      return res.status(401).json({
        error: "UBER_NOT_CONNECTED",
        message: "Please connect your Uber account first."
      });
    }

    if (
      user.uberAccessToken.startsWith("demo_") &&
      UBER_DEMO_MODE
    ) {
      return res.json({
        active: true,
        demoMode: true,
        ride: demoRide()
      });
    }

    const response = await uberRequest(
      user,
      "/requests/current"
    );

    if (response.status === 404) {
      return res.json({
        active: false,
        message: "No active Uber ride in progress."
      });
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        error:
          data.message ||
          data.error ||
          `Uber API returned error ${response.status}`
      });
    }

    return res.json({
      active: true,
      ride: formatUberRide(data)
    });

  } catch (error) {
    next(error);
  }
});

// ======================================================
// POST /api/uber/share-ride
// Share current ride details with trusted contacts
// ======================================================

router.post("/share-ride", async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        error: "User not found."
      });
    }

    let ride = req.body.ride;

    // If no ride details were supplied, fetch the current ride.
    if (!ride && user.uberAccessToken) {
      if (
        user.uberAccessToken.startsWith("demo_") &&
        UBER_DEMO_MODE
      ) {
        ride = demoRide();
      } else {
        const response = await uberRequest(
          user,
          "/requests/current"
        );

        if (response.ok) {
          const data = await response.json();
          ride = formatUberRide(data);
        }
      }
    }

    if (!ride) {
      return res.status(400).json({
        error: "No active ride details available to share."
      });
    }

    const contacts = await Contact.find({
      owner: req.user._id
    });

    const phoneContacts = contacts.filter(
      contact => contact.phone
    );

    if (!phoneContacts.length) {
      return res.status(409).json({
        error: "No trusted contacts with phone numbers found."
      });
    }

    const locationLine =
      ride.currentLatitude != null &&
      ride.currentLongitude != null
        ? `📍 Current location: https://maps.google.com/?q=${ride.currentLatitude},${ride.currentLongitude}`
        : "📍 Current location is unavailable.";

    const message = [
      `🚗 SAFEHER Uber Ride Alert from ${user.name}:`,
      `Service: ${ride.service || "Uber"}`,
      `Driver: ${ride.driverName || "Not available"}`,
      ride.driverPhone
        ? `Driver Phone: ${ride.driverPhone}`
        : "",
      `Vehicle: ${ride.vehicle || "Not available"}`,
      `Plate: ${ride.plate || "Not available"}`,
      ride.destination
        ? `Destination: ${ride.destination}`
        : "",
      ride.tripId
        ? `Trip ID: ${ride.tripId}`
        : "",
      locationLine,
      "Shared via SAFEHER for safety tracking."
    ]
      .filter(Boolean)
      .join("\n");

    const smsConfigured = Boolean(
      process.env.FAST2SMS_API_KEY
    );

    const results = await Promise.all(
      phoneContacts.map(async contact => {
        try {
          const result = await sendSms(
            contact.phone,
            message
          );

          return {
            name: contact.name,
            phone: contact.phone,
            ok: Boolean(result?.ok)
          };
        } catch (error) {
          console.error(
            `SMS failed for ${contact.phone}:`,
            error.message
          );

          return {
            name: contact.name,
            phone: contact.phone,
            ok: false
          };
        }
      })
    );

    // Notify connected family members through Socket.IO.
    const io = req.app.get("io");

    if (io) {
      const familyUserIds = contacts
        .map(contact => contact.contactUserId)
        .filter(Boolean);

      familyUserIds.forEach(userId => {
        io.to(`user:${userId}`).emit("family:ride", {
          userName: user.name,
          ride,
          sharedAt: new Date().toISOString()
        });
      });
    }

    const sentCount = results.filter(
      result => result.ok
    ).length;

    return res.json({
      ok: true,
      sentCount,
      totalContacts: phoneContacts.length,
      smsConfigured,
      results
    });

  } catch (error) {
    next(error);
  }
});

// ======================================================
// POST /api/uber/disconnect
// Disconnect Uber account locally
// ======================================================

router.post("/disconnect", async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        error: "User not found."
      });
    }

    user.uberAccessToken = undefined;
    user.uberRefreshToken = undefined;
    user.uberConnectedAt = undefined;

    await user.save();

    res.json({
      ok: true,
      message: "Uber account disconnected from SAFEHER."
    });

  } catch (error) {
    next(error);
  }
});

// ======================================================

module.exports = router;
