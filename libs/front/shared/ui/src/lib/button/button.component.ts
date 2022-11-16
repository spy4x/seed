import { Component, Input, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'seed-button',
  template: `
    <button [type]="bType" [ngClass]="getClasses()" [attr.data-e2e]="e2e" [disabled]="disabled">
      <ng-content></ng-content>
    </button>
  `,
  encapsulation: ViewEncapsulation.None,
})
export class ButtonComponent {
  @Input() text = '';

  @Input() bType = 'button';

  @Input() e2e = '';

  @Input() disabled = false;

  @Input() color:
    | 'primary'
    | 'secondary'
    | 'light'
    | 'white'
    | 'transparent'
    | 'link'
    | 'danger'
    | 'warning'
    | 'success' = 'primary';

  @Input() isIcon = false;

  @Input() classes = '';

  @Input() alignment = 'items-center justify-center';

  static getBaseClasses(): string {
    return `inline-flex gap-1 focus:outline-none focus:ring-2 focus:ring-offset-2 shadow-sm font-medium rounded-md border disabled:cursor-not-allowed disabled:opacity-30 transition duration-200 ease-in`;
  }

  getClasses(): string {
    return [
      ButtonComponent.getBaseClasses(),
      this.getSizeClasses(),
      this.getColorClasses(),
      this.classes,
      this.alignment,
    ].join(' ');
  }

  getSizeClasses(): string {
    return `text-sm p-2 ${!this.isIcon && 'px-4'}`;
  }

  getColorClasses(): string {
    switch (this.color) {
      case 'primary':
        return 'text-white bg-indigo-600 hover:bg-indigo-700 focus:ring-indigo-500 border-transparent';
      case 'secondary':
        return 'text-white bg-gray-600 hover:bg-gray-700 focus:ring-gray-500 border-transparent';
      case 'light':
        return 'text-gray-800 bg-gray-100 hover:bg-gray-200 hover:text-gray-900 focus:ring-gray-200 border-transparent';
      case 'white':
        return 'bg-white hover:bg-gray-100 focus:ring-gray-200 shadow-none border-gray-300';
      case 'transparent':
        return 'hover:bg-gray-100 focus:ring-gray-200 shadow-none border-transparent';
      case 'link':
        return 'text-sky-500 bg-transparent shadow-none underline decoration-sky-500 hover:text-sky-700 border-transparent';
      case 'danger':
        return 'text-white bg-red-600 hover:bg-red-700 focus:ring-red-500 border-transparent';
      case 'warning':
        return 'text-amber-50 bg-amber-400 hover:bg-amber-500 focus:ring-amber-500 border-transparent';
      case 'success':
        return 'text-white bg-green-600 hover:bg-green-700 focus:ring-green-500 border-transparent';
    }
  }
}
