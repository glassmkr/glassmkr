interface ToastItem {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

let toasts = $state<ToastItem[]>([]);
let nextId = 0;

export function getToasts() {
  return {
    get items() {
      return toasts;
    },
    show(
      message: string,
      type: "success" | "error" | "info" = "info",
      duration = 3000,
    ) {
      const id = nextId++;
      toasts = [...toasts, { id, message, type }];
      setTimeout(() => {
        toasts = toasts.filter((t) => t.id !== id);
      }, duration);
    },
  };
}
