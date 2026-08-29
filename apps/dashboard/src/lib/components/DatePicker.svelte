<script lang="ts">
  // Themed flatpickr wrapper. Replaces native <input type="date"> /
  // <input type="datetime-local"> across the dashboard so the popup
  // (a) renders consistently across browsers/OSes and (b) honours
  // the dashboard's --accent / --surface / --text-* tokens.
  //
  // API kept close to the native inputs it replaces — the parent
  // binds a string value (YYYY-MM-DD or YYYY-MM-DDTHH:MM) and the
  // component handles all picker UI.
  //
  // Footer: three custom buttons injected via onReady, since
  // flatpickr ships none by default:
  //   [Clear]   wipes the selection
  //   [Today]   sets to current date (+ midnight if enableTime)
  //   [Done]    commits + closes (mirrors Enter)
  // Escape closes without committing (flatpickr's default behavior;
  // we don't touch it).
  import { onMount, onDestroy } from "svelte";
  import flatpickr from "flatpickr";
  import type { Instance as FlatpickrInstance } from "flatpickr/dist/types/instance";
  import "flatpickr/dist/flatpickr.min.css";
  import "./datepicker-theme.css";

  interface Props {
    /** ISO-ish date string. Date-only mode emits YYYY-MM-DD; date+time emits YYYY-MM-DDTHH:MM (matches the native datetime-local contract). */
    value: string;
    /** Date+time mode. Default false (date-only). */
    enableTime?: boolean;
    /** Earliest selectable date. String (any parseable format) or Date. */
    minDate?: string | Date;
    /** Latest selectable date. */
    maxDate?: string | Date;
    /** Native input id, for label-for association. */
    id?: string;
    /** Placeholder shown when no date is selected. */
    placeholder?: string;
    /** Disabled state. */
    disabled?: boolean;
  }

  let {
    value = $bindable(""),
    enableTime = false,
    minDate,
    maxDate,
    id,
    placeholder = "",
    disabled = false,
  }: Props = $props();

  let inputEl: HTMLInputElement;
  // flatpickr() is overloaded: passing a single Element returns Instance,
  // passing a NodeList/array returns Instance[]. We always pass a single
  // input so the runtime value is Instance, but the .d.ts signature widens
  // to the union — cast on assignment to keep `.input` / `.setDate` /
  // `.clear` / `.destroy` properties accessible without type-narrowing.
  let fp: FlatpickrInstance | null = null;

  // flatpickr's tokens: Y=4-digit year, m=2-digit month, d=2-digit day,
  // H=24h hour, i=2-digit minute. Backslash escapes the literal 'T' so
  // datetime-local output reads as `2026-05-16T14:30`.
  const dateFormat = $derived(enableTime ? "Y-m-d\\TH:i" : "Y-m-d");

  onMount(() => {
    fp = flatpickr(inputEl, {
      dateFormat,
      enableTime,
      // 24h time matches the rest of the dashboard (no AM/PM anywhere).
      time_24hr: true,
      // Week starts Monday — matches the European convention used by
      // the rest of the dashboard's timestamps.
      locale: { firstDayOfWeek: 1 },
      minDate,
      maxDate,
      // We override flatpickr's default styling via datepicker-theme.css;
      // disabling animations keeps things crisp on the dark UI.
      animate: false,
      // Inject Clear / Today / Done footer.
      onReady: (_selectedDates, _dateStr, instance) => {
        const footer = document.createElement("div");
        footer.className = "fp-custom-footer";

        const clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.className = "fp-footer-btn fp-footer-clear";
        clearBtn.textContent = "Clear";
        clearBtn.addEventListener("click", (e) => {
          e.preventDefault();
          instance.clear();
        });

        const todayBtn = document.createElement("button");
        todayBtn.type = "button";
        todayBtn.className = "fp-footer-btn fp-footer-today";
        todayBtn.textContent = "Today";
        todayBtn.addEventListener("click", (e) => {
          e.preventDefault();
          // setDate triggers onChange → value binding updates.
          // For datetime mode, anchor to now() so the time portion
          // is meaningful; for date-only it's midnight either way.
          instance.setDate(new Date(), true);
        });

        const doneBtn = document.createElement("button");
        doneBtn.type = "button";
        doneBtn.className = "fp-footer-btn fp-footer-done";
        doneBtn.textContent = "Done";
        doneBtn.addEventListener("click", (e) => {
          e.preventDefault();
          instance.close();
        });

        footer.append(clearBtn, todayBtn, doneBtn);
        instance.calendarContainer.appendChild(footer);

        // HH / MM column captions. flatpickr's time-picker DOM is:
        //   .flatpickr-time
        //     .numInputWrapper  (hour)
        //     .flatpickr-time-separator  (":")
        //     .numInputWrapper  (minute)
        // We inject a real <div class="fp-time-label"> as the first
        // child of each numInputWrapper. The wrapper is flex-column
        // (see datepicker-theme.css) so the caption stacks above
        // the spinner input. First iteration used a single ::before
        // pseudo-element with content "HH    MM" which collapsed to
        // one string and rendered next to the colon — Simon caught
        // that in eyeball.
        if (enableTime && instance.timeContainer) {
          const wrappers = instance.timeContainer.querySelectorAll<HTMLDivElement>(
            ".numInputWrapper",
          );
          const labels: Array<[number, string]> = [
            [0, "HH"],
            [1, "MM"],
          ];
          for (const [idx, text] of labels) {
            const w = wrappers[idx];
            if (!w) continue;
            const label = document.createElement("div");
            label.className = "fp-time-label";
            label.textContent = text;
            w.insertBefore(label, w.firstChild);
          }
        }
      },
      onChange: (_dates, dateStr) => {
        // flatpickr emits the string formatted per `dateFormat`; bind
        // it back to the parent so the existing toISOString() / string
        // comparisons downstream keep working.
        value = dateStr;
      },
      defaultDate: value || undefined,
    }) as FlatpickrInstance;
  });

  // Keep the picker in sync if the parent reassigns `value` (e.g. a
  // form reset). flatpickr's setDate(_, false) updates without firing
  // onChange, so we don't loop.
  $effect(() => {
    if (!fp) return;
    const current = fp.input.value;
    if (value !== current) {
      if (value) fp.setDate(value, false);
      else fp.clear(false);
    }
  });

  onDestroy(() => {
    fp?.destroy();
    fp = null;
  });
</script>

<input
  bind:this={inputEl}
  type="text"
  class="fp-input"
  {id}
  {placeholder}
  {disabled}
  autocomplete="off"
  readonly
/>

<style>
  /* Component-local rules. Anything that targets flatpickr-generated
     DOM (which lives outside this component's scope) is in
     datepicker-theme.css and uses :global() / unscoped selectors. */
  .fp-input {
    width: 100%;
    padding: 8px 10px;
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 14px;
    font-family: var(--font-sans);
    cursor: pointer;
  }
  .fp-input:disabled { opacity: 0.5; cursor: not-allowed; }
  .fp-input:focus { outline: none; border-color: var(--accent); }
</style>
