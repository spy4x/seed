import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'seed-alert',
  templateUrl: './alert.component.html',
  styles: [
    `
      seed-alert {
        display: block;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertComponent {
  @Input() title = '';

  @Input() text = '';

  @Input() color: 'info' | 'warning' | 'danger' | 'success' = 'warning';

  @Input() closeable = false;

  @Input() e2e?: string;

  @Output() closed = new EventEmitter<void>();

  getBackgroundColor(): string {
    switch (this.color) {
      case 'info':
        return 'bg-blue-50';
      case 'warning':
        return 'bg-yellow-50';
      case 'danger':
        return 'bg-red-50';
      case 'success':
        return 'bg-green-50';
    }
  }

  getTextColor(): string {
    switch (this.color) {
      case 'info':
        return 'text-blue-700';
      case 'warning':
        return 'text-yellow-700';
      case 'danger':
        return 'text-red-700';
      case 'success':
        return 'text-green-700';
    }
  }

  getIconClass(): string {
    switch (this.color) {
      case 'info':
        return 'feather-info text-blue-400';
      case 'warning':
        return 'feather-alert-triangle text-yellow-400';
      case 'danger':
        return 'feather-alert-circle text-red-400';
      case 'success':
        return 'feather-check-circle text-green-400';
    }
  }
}
