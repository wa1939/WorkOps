"use client";

import { useEffect, useState } from "react";
import { Cloud, CloudDrizzle, CloudFog, CloudRain, CloudSnow, Sun, CloudSun } from "lucide-react";

interface WeatherData {
    temperature: number;
    code: number;
}

const CACHE_KEY = "weather_cache";
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function getWeatherIcon(code: number) {
    if (code === 0) return <Sun className="h-5 w-5 text-yellow-500" />;
    if (code <= 3) return <CloudSun className="h-5 w-5 text-blue-400" />;
    if (code <= 48) return <CloudFog className="h-5 w-5 text-gray-400" />;
    if (code <= 55) return <CloudDrizzle className="h-5 w-5 text-blue-400" />;
    if (code <= 67) return <CloudRain className="h-5 w-5 text-blue-500" />;
    if (code <= 77) return <CloudSnow className="h-5 w-5 text-blue-200" />;
    if (code <= 82) return <CloudRain className="h-5 w-5 text-blue-600" />;
    return <Cloud className="h-5 w-5 text-gray-400" />;
}

function getWeatherLabel(code: number) {
    if (code === 0) return "Clear";
    if (code <= 3) return "Partly cloudy";
    if (code <= 48) return "Foggy";
    if (code <= 55) return "Drizzle";
    if (code <= 67) return "Rain";
    if (code <= 77) return "Snow";
    if (code <= 82) return "Showers";
    return "Stormy";
}

export function WeatherWidget() {
    const [weather, setWeather] = useState<WeatherData | null>(null);

    useEffect(() => {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
            const { data, ts } = JSON.parse(cached);
            if (Date.now() - ts < CACHE_TTL) {
                setWeather(data);
                return;
            }
        }

        fetch(
            "https://api.open-meteo.com/v1/forecast?latitude=24.7136&longitude=46.6753&current=temperature_2m,weather_code&timezone=Asia/Riyadh"
        )
            .then((r) => r.json())
            .then((json) => {
                const data: WeatherData = {
                    temperature: Math.round(json.current.temperature_2m),
                    code: json.current.weather_code,
                };
                setWeather(data);
                localStorage.setItem(
                    CACHE_KEY,
                    JSON.stringify({ data, ts: Date.now() })
                );
            })
            .catch(() => {
                // fail silently
            });
    }, []);

    if (!weather) return null;

    return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {getWeatherIcon(weather.code)}
            <span className="font-medium text-foreground">{weather.temperature}°C</span>
            <span>{getWeatherLabel(weather.code)}</span>
            <span className="text-xs">Riyadh</span>
        </div>
    );
}
