/**
 * 通知状态管理
 * 替代原项目中的 showNotification 方法
 */

import { create } from 'zustand';
import type { ReactNode } from 'react';
import type { Notification, NotificationType } from '@/types';
import { generateId } from '@/utils/helpers';
import { NOTIFICATION_DURATION_MS } from '@/utils/constants';

interface ConfirmationOptions {
  title?: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'primary' | 'secondary';
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
}

interface NotificationState {
  notifications: Notification[];
  confirmation: {
    isOpen: boolean;
    isLoading: boolean;
    options: ConfirmationOptions | null;
  };
  showNotification: (message: string, type?: NotificationType, duration?: number) => void;
  removeNotification: (id: string) => void;
  showConfirmation: (options: ConfirmationOptions) => void;
  hideConfirmation: () => void;
  setConfirmationLoading: (loading: boolean) => void;
  resetForConnection: () => void;
}

export const useNotificationStore = create<NotificationState>((set) => {
  let generation = 0;
  const scopedActions = () => {
    const scope = ++generation;
    return {
      showNotification: (
        message: string,
        type: NotificationType = 'info',
        duration = NOTIFICATION_DURATION_MS
      ) => {
        if (scope !== generation) return;
        const notification: Notification = { id: generateId(), message, type, duration };
        set((state) => ({ notifications: [...state.notifications, notification] }));
      },
      showConfirmation: (options: ConfirmationOptions) => {
        if (scope !== generation) return;
        set({ confirmation: { isOpen: true, isLoading: false, options } });
      },
      hideConfirmation: () => {
        if (scope !== generation) return;
        set({ confirmation: { isOpen: false, isLoading: false, options: null } });
      },
      setConfirmationLoading: (loading: boolean) => {
        if (scope !== generation) return;
        set((state) => ({ confirmation: { ...state.confirmation, isLoading: loading } }));
      },
    };
  };
  return {
    notifications: [],
    confirmation: {
      isOpen: false,
      isLoading: false,
      options: null,
    },

    ...scopedActions(),
    // Rotate action identities so callbacks held by the old principal cannot publish UI state.
    resetForConnection: () =>
      set({
        ...scopedActions(),
        notifications: [],
        confirmation: { isOpen: false, isLoading: false, options: null },
      }),

    removeNotification: (id) => {
      set((state) => ({
        notifications: state.notifications.filter((n) => n.id !== id),
      }));
    },
  };
});
