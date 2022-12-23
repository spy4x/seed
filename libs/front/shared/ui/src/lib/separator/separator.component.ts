import { Component, Input } from '@angular/core';

@Component({
  selector: 'seed-separator',
  template: `
    <div class="relative">
      <div class="absolute inset-0 flex items-center">
        <div class="w-full border-t border-gray-300"></div>
      </div>
      <div class="relative flex justify-center text-sm">
        <span class="bg-white px-2 text-gray-500">{{ text }}</span>
      </div>
    </div>
  `,
})
export class SeparatorComponent {
  @Input() text = 'Or';
}
