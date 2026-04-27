import axios from "axios";
import { toast } from "sonner";

type ApiErrorPayload = {
  error?: string;
  message?: string;
  details?: Record<string, string[] | undefined>;
};

function flattenDetails(details?: Record<string, string[] | undefined>) {
  if (!details) return null;

  const messages = Object.values(details)
    .flatMap((value) => value ?? [])
    .filter(Boolean);

  if (messages.length === 0) return null;
  return messages.join(", ");
}

export function getErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError<ApiErrorPayload>(error)) {
    const data = error.response?.data;
    const detailMessage = flattenDetails(data?.details);

    return detailMessage ?? data?.error ?? data?.message ?? fallback;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

export function showErrorToast(error: unknown, fallback: string) {
  const message = getErrorMessage(error, fallback);
  toast.error(message);
  return message;
}

export function showSuccessToast(message: string) {
  toast.success(message);
  return message;
}

export function showInfoToast(message: string) {
  toast.info(message);
  return message;
}
