import { ChangeDetectionStrategy, Component, HostBinding, Input } from '@angular/core';

@Component({
  /* eslint-disable-next-line @angular-eslint/component-selector */
  selector: 'div[seed-loading]',
  templateUrl: './loading.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoadingComponent {
  @Input() text = 'Loading';

  @HostBinding('class') class =
    'flex h-full w-full items-center justify-center gap-1 bg-gray-100/50 text-lg text-sky-400';

  @HostBinding('attr.data-e2e') e2e = 'loading';
}
