import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './RoutingPanels.module.scss';

export interface RowMenuItem {
  id: string;
  label: string;
  /** A second, quieter line (for example the provider of a target account). */
  hint?: string;
  disabled?: boolean;
  onSelect: () => void;
}

export interface RowMenuSection {
  /** Small caption above the items ("Move to…"). */
  label?: string;
  items: RowMenuItem[];
}

interface RowMenuProps {
  ariaLabel: string;
  sections: RowMenuSection[];
  disabled?: boolean;
}

const VIEWPORT_MARGIN = 8;
const MENU_OFFSET = 4;

/**
 * The "⋯" menu of a row. The list is portalled and fixed-positioned so it is never clipped by
 * the panel, and it closes on outside click, Escape, scroll and resize.
 */
export function RowMenu({ ariaLabel, sections, disabled = false }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  // Position after the menu has its real size, before the browser paints it.
  useLayoutEffect(() => {
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (!open || !button || !menu) return;
    const rect = button.getBoundingClientRect();
    const height = menu.offsetHeight;
    const width = menu.offsetWidth;
    const below = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
    const above = rect.top - VIEWPORT_MARGIN;
    const top =
      below >= height || below >= above
        ? rect.bottom + MENU_OFFSET
        : Math.max(VIEWPORT_MARGIN, rect.top - height - MENU_OFFSET);
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.right - width),
      Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN)
    );
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    menu.style.visibility = 'visible';
    menu.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close(false);
    };
    const onScrollOrResize = (event: Event) => {
      if (
        menuRef.current &&
        event.target instanceof Node &&
        menuRef.current.contains(event.target)
      ) {
        return;
      }
      close(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open, close]);

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === 'Tab') {
      close(false);
      return;
    }
    if (
      event.key !== 'ArrowDown' &&
      event.key !== 'ArrowUp' &&
      event.key !== 'Home' &&
      event.key !== 'End'
    ) {
      return;
    }
    event.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []
    );
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (current + 1) % items.length
            : (current - 1 + items.length) % items.length;
    items[next].focus();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={styles.menuButton}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={ariaLabel}
            className={styles.menu}
            style={{ top: 0, left: 0, visibility: 'hidden' }}
            onKeyDown={onMenuKeyDown}
          >
            {sections.map((section, index) => (
              <div key={section.label ?? index} role="none">
                {index > 0 && <div className={styles.menuSeparator} role="separator" />}
                {section.label && (
                  <div className={styles.menuLabel} role="presentation">
                    {section.label}
                  </div>
                )}
                {section.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    className={styles.menuItem}
                    disabled={item.disabled}
                    onClick={() => {
                      close(true);
                      item.onSelect();
                    }}
                  >
                    <span>{item.label}</span>
                    {item.hint && <span className={styles.menuSub}>{item.hint}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
