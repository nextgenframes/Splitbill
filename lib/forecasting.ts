export type UtilityKind = "electric" | "water" | "garbage" | "internet";
export type NotificationChannel = "email" | "sms" | "push";
export type NotificationKind = "upcoming_bill" | "overdue_balance" | "completed_payment" | "bill_spike";

export type MonthlyUtilityCost = {
  month: string;
  electric: number;
  water: number;
  garbage: number;
  internet: number;
};

export type UtilityForecast = {
  kind: UtilityKind;
  label: string;
  lastAmount: number;
  predictedAmount: number;
  percentChange: number;
  trend: "up" | "down" | "flat";
  spike: boolean;
  reason: string;
  suggestion: string;
};

export type NotificationPreference = {
  channels: Record<NotificationChannel, boolean>;
  quietHours: { start: string; end: string };
  reminders: {
    upcomingBills: boolean;
    overdueBalances: boolean;
    completedPayments: boolean;
    unusualSpikes: boolean;
  };
};

export type SmartNotification = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  channel: NotificationChannel;
  priority: "normal" | "high";
  scheduledFor: string;
};

const labels: Record<UtilityKind, string> = {
  electric: "Electric",
  water: "Water",
  garbage: "Garbage",
  internet: "Internet"
};

export function forecastUtilities(history: MonthlyUtilityCost[]): UtilityForecast[] {
  const latest = history.at(-1)!;
  const previous = history.slice(-4, -1);

  return (Object.keys(labels) as UtilityKind[]).map((kind) => {
    const movingAverage = previous.reduce((sum, month) => sum + month[kind], 0) / previous.length;
    const seasonalLift = kind === "electric" ? 1.215 : kind === "water" ? 1.06 : 1.01;
    const predictedAmount = roundMoney((movingAverage * 0.45 + latest[kind] * 0.55) * seasonalLift);
    const percentChange = Math.round(((predictedAmount - latest[kind]) / latest[kind]) * 100);
    const spike = percentChange >= 15 || predictedAmount > movingAverage * 1.22;

    return {
      kind,
      label: labels[kind],
      lastAmount: latest[kind],
      predictedAmount,
      percentChange,
      trend: percentChange > 4 ? "up" : percentChange < -4 ? "down" : "flat",
      spike,
      reason: getReason(kind, percentChange),
      suggestion: getSuggestion(kind, spike)
    };
  });
}

export function buildSmartNotifications(
  forecasts: UtilityForecast[],
  preferences: NotificationPreference
): SmartNotification[] {
  const channel = preferences.channels.push ? "push" : preferences.channels.sms ? "sms" : "email";
  const notifications: SmartNotification[] = [];

  if (preferences.reminders.upcomingBills) {
    notifications.push({
      id: "notify_upcoming_pge",
      kind: "upcoming_bill",
      title: "Electric bill due soon",
      body: "Pacific Gas & Electric is due in 3 days. Jordan and Avery still have open shares.",
      channel,
      priority: "normal",
      scheduledFor: nextAllowedTime("2026-05-30T09:00:00", preferences)
    });
  }

  if (preferences.reminders.overdueBalances) {
    notifications.push({
      id: "notify_overdue_water",
      kind: "overdue_balance",
      title: "Water balance overdue",
      body: "Jordan has an overdue City Water share. Send reminder with proof attached.",
      channel,
      priority: "high",
      scheduledFor: nextAllowedTime("2026-05-24T09:00:00", preferences)
    });
  }

  if (preferences.reminders.completedPayments) {
    notifications.push({
      id: "notify_paid_comcast",
      kind: "completed_payment",
      title: "Payment received",
      body: "Sam paid Comcast Internet via PayPal.",
      channel,
      priority: "normal",
      scheduledFor: nextAllowedTime("2026-05-24T12:00:00", preferences)
    });
  }

  if (preferences.reminders.unusualSpikes) {
    forecasts
      .filter((forecast) => forecast.spike)
      .forEach((forecast) => {
        notifications.push({
          id: `notify_spike_${forecast.kind}`,
          kind: "bill_spike",
          title: `${forecast.label} spike forecast`,
          body: `${forecast.label} may increase ${forecast.percentChange}% next month. ${forecast.suggestion}`,
          channel,
          priority: "high",
          scheduledFor: nextAllowedTime("2026-05-24T10:00:00", preferences)
        });
      });
  }

  return notifications;
}

function nextAllowedTime(iso: string, preferences: NotificationPreference) {
  const date = new Date(iso);
  const hour = date.getHours();
  const start = Number(preferences.quietHours.start.split(":")[0]);
  const end = Number(preferences.quietHours.end.split(":")[0]);
  const inQuietHours = start > end ? hour >= start || hour < end : hour >= start && hour < end;

  if (!inQuietHours) return iso;
  date.setHours(end, 0, 0, 0);
  return date.toISOString().slice(0, 16);
}

function getReason(kind: UtilityKind, change: number) {
  if (kind === "electric" && change > 0) return `Your electric bill may increase ${change}% next month due to seasonal usage.`;
  if (kind === "water" && change > 0) return `Water may rise ${change}% from recent usage trend.`;
  if (kind === "internet") return "Internet is stable because plan price is fixed.";
  return change > 0 ? "Trend is above recent average." : "Trend is stable versus recent average.";
}

function getSuggestion(kind: UtilityKind, spike: boolean) {
  if (kind === "electric") return spike ? "Set thermostat schedule and compare peak-hour use." : "Keep current usage pattern.";
  if (kind === "water") return "Check leaks and run laundry in full loads.";
  if (kind === "garbage") return "Right-size bin plan if overage fees appear.";
  return "Review promo expiration before renewal.";
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
