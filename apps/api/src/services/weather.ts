import { env } from "../config/env";
import type { TripStop } from "@quickroutesai/shared";

export const isWeatherConfigured = !!env.WEATHER_API_KEY;

export interface WeatherCurrent {
  timestamp: number;
  main: string;
  description: string;
  icon: string;
  temperatureF: number;
  precipitationChance: number; 
  visibilityMiles: number;
  windSpeedMph: number;
  actualTime: string; // human-readable time for easier logging
}

export interface WeatherForecastHour {
  timestamp: number;
  main: string;
  description: string;
  icon: string;
  temperatureF: number;
  precipitationChance: number; 
  visibilityMiles: number;
  windSpeedMph: number;
}

export interface StopWeather {
  stopId: string;
  address: string;
  lat: number;
  lng: number;
  current: WeatherCurrent;
  forecast: WeatherForecastHour[];
}

export interface ComputeWeatherResult {
  stops: StopWeather[];
}

interface OpenWeatherCondition {
  id?: number;
  main?: string;
  description?: string;
  icon?: string;
}

interface OpenWeatherCurrent {
  dt: number;
  temp: number;
  visibility?: number; // meters
  wind_speed?: number; // mph 
  weather?: OpenWeatherCondition[];
  rain?: {
    "1h"?: number;
  };
  snow?: {
    "1h"?: number;
  };
}

interface OpenWeatherHourly {
  dt: number;
  temp: number;
  visibility?: number; // meters
  wind_speed?: number; // mph 
  pop?: number; 
  weather?: OpenWeatherCondition[];
  rain?: {
    "1h"?: number;
  };
  snow?: {
    "1h"?: number;
  };
}

interface OpenWeatherOneCallResponse {
  lat: number;
  lon: number;
  timezone: string;
  timezone_offset: number;
  current: OpenWeatherCurrent;
  hourly?: OpenWeatherHourly[];
}

function metersToMiles(meters: number): number {
  return meters / 1609.34;
}

function getCondition(condition?: OpenWeatherCondition) {
  return {
    main: condition?.main ?? "Unknown",
    description: condition?.description ?? "Unknown",
    icon: condition?.icon ?? "",
  };
}

function mapCurrentWeather(current: OpenWeatherCurrent): WeatherCurrent {
  const condition = getCondition(current.weather?.[0]);

  return {
    timestamp: current.dt,
    actualTime: new Date(current.dt * 1000).toLocaleString(),
    main: condition.main,
    description: condition.description,
    icon: condition.icon,
    temperatureF: current.temp,
    precipitationChance: 0, 
    visibilityMiles: metersToMiles(current.visibility ?? 0),
    windSpeedMph: current.wind_speed ?? 0,
  };
}

function mapHourlyWeather(hour: OpenWeatherHourly): WeatherForecastHour {
  const condition = getCondition(hour.weather?.[0]);

  return {
    timestamp: hour.dt,
    main: condition.main,
    description: condition.description,
    icon: condition.icon,
    temperatureF: hour.temp,
    precipitationChance: hour.pop ?? 0,
    visibilityMiles: metersToMiles(hour.visibility ?? 0),
    windSpeedMph: hour.wind_speed ?? 0,
  };
}

export async function computeWeather(stops: TripStop[], forecastHours = 6): Promise<ComputeWeatherResult> {

    if (!isWeatherConfigured) {
    throw new Error("Weather API is not configured — set WEATHER_API_KEY");
    }

    const apiKey = env.WEATHER_API_KEY!;
    
    if (!Array.isArray(stops) || stops.length === 0) {
    return { stops: [] };
    }

    const results = await Promise.all(
    stops.map(async (stop) => {
        if (
        typeof stop.lat !== "number" ||
        typeof stop.lng !== "number" ||
        Number.isNaN(stop.lat) ||
        Number.isNaN(stop.lng)
        ) {
        throw new Error(
            `Invalid coordinates for stop ${stop.stopId ?? "(missing stopId)"}`
        );
        }

        const params = new URLSearchParams({
        lat: String(stop.lat),
        lon: String(stop.lng),
        appid: apiKey,
        units: "imperial",
        exclude: "minutely,daily,alerts",
        });

        const response = await fetch(
        `https://api.openweathermap.org/data/3.0/onecall?${params.toString()}`
        );

        if (!response.ok) {
        const body = await response.text();
        throw new Error(
            `Weather API error for stop ${stop.stopId}: ${response.status} ${body}`
        );
        }

        const data = (await response.json()) as OpenWeatherOneCallResponse;

        if (!data.current) {
        throw new Error(
            `Weather API returned no current weather for stop ${stop.stopId}`
        );
        }

        return {
        stopId: stop.stopId,
        address: stop.address,
        lat: stop.lat,
        lng: stop.lng,
        current: mapCurrentWeather(data.current),
        forecast: (data.hourly ?? [])
            .slice(0, forecastHours)
            .map(mapHourlyWeather),
        };
    })
    );

    return { stops: results };
}

function getHourlyTimestampsInclusive(
  startTimestampSeconds: number,
  endTimestampSeconds?: number
): number[] {
  const end = endTimestampSeconds ?? startTimestampSeconds;

  if (end < startTimestampSeconds) {
    throw new Error("endTimestampSeconds cannot be before startTimestampSeconds");
  }

  const HOUR_SECONDS = 3600;

  // Round start down to the hour
  const startHour = Math.floor(startTimestampSeconds / HOUR_SECONDS) * HOUR_SECONDS;

  // Round end up to the hour
  const endHour =
    end % HOUR_SECONDS === 0
      ? end
      : Math.ceil(end / HOUR_SECONDS) * HOUR_SECONDS;

  const timestamps: number[] = [];

  for (let ts = startHour; ts <= endHour; ts += HOUR_SECONDS) {
    timestamps.push(ts);
  }

  return timestamps;
}

interface OpenWeatherTimeMachineResponse {
  lat: number;
  lon: number;
  timezone?: string;
  timezone_offset?: number;
  data?: OpenWeatherHourly[];
  current?: OpenWeatherCurrent;
  hourly?: OpenWeatherHourly[];
}

export async function computeHistoricalWeather(
  stops: TripStop[],
  startTimestampSeconds: number,
  endTimestampSeconds?: number
) {
  if (!isWeatherConfigured) {
    throw new Error("Weather API is not configured — set WEATHER_API_KEY");
  }

  const apiKey = env.WEATHER_API_KEY!;
  const hourlyTimestamps = getHourlyTimestampsInclusive(
    startTimestampSeconds,
    endTimestampSeconds
  );

  const results = await Promise.all(
    stops.map(async (stop) => {
      if (
        typeof stop.lat !== "number" ||
        typeof stop.lng !== "number" ||
        Number.isNaN(stop.lat) ||
        Number.isNaN(stop.lng)
      ) {
        throw new Error(
          `Invalid coordinates for stop ${stop.stopId ?? "(missing stopId)"}`
        );
      }

      const hourlyWeather = await Promise.all(
        hourlyTimestamps.map(async (timestampSeconds) => {
          const params = new URLSearchParams({
            lat: String(stop.lat),
            lon: String(stop.lng),
            dt: String(timestampSeconds),
            appid: apiKey,
            units: "imperial",
          });

          const response = await fetch(
            `https://api.openweathermap.org/data/3.0/onecall/timemachine?${params.toString()}`
          );

          if (!response.ok) {
            const body = await response.text();
            throw new Error(
              `Historical weather API error for stop ${stop.stopId} at ${timestampSeconds}: ${response.status} ${body}`
            );
          }

          const data = (await response.json()) as OpenWeatherTimeMachineResponse;
          
          const currentLike = data.data?.[0] ?? data.current ?? data.hourly?.[0];

          if (!currentLike) {
            throw new Error(
              `No historical weather returned for stop ${stop.stopId} at ${timestampSeconds}`
            );
          }

          return mapCurrentWeather(currentLike);
        })
      );

      return {
        stopId: stop.stopId,
        address: stop.address,
        lat: stop.lat,
        lng: stop.lng,
        current: hourlyWeather[0],
        forecast: hourlyWeather, 
      };
    })
  );

  return { stops: results };
}