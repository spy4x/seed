import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { AuthProvider } from '@seed/front/shared/types';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

interface ProviderModel {
  id: AuthProvider;
  title: string;
  iconClasses?: string;
  iconSVG?: SafeHtml;
}

@Component({
  selector: 'shared-auth-ui-providers-list',
  templateUrl: './providers-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
    `,
  ],
})
export class ProvidersListComponent {
  @Input() providers: AuthProvider[] = [];

  @Input() inProgress = false;

  @Input() selected?: AuthProvider;

  @Output() provider = new EventEmitter<AuthProvider>();

  providerModels: ProviderModel[] = [
    {
      id: AuthProvider.google,
      title: 'Google',
      iconSVG: this.sanitizer.bypassSecurityTrustHtml(`
        <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 mr-1" viewBox="0 0 256 256" version="1.1">
          <g id="surface1">
            <path style=" stroke:none;fill-rule:nonzero;fill:rgb(25.882353%,52.156863%,95.686275%);fill-opacity:1;" d="M 253.28125 130.878906 C 253.28125 122.453125 252.535156 114.453125 251.253906 106.667969 L 130.71875 106.667969 L 130.71875 154.773438 L 199.734375 154.773438 C 196.640625 170.558594 187.574219 183.894531 174.132812 192.960938 L 174.132812 224.960938 L 215.308594 224.960938 C 239.414062 202.667969 253.28125 169.8125 253.28125 130.878906 Z M 253.28125 130.878906 "/>
            <path style=" stroke:none;fill-rule:nonzero;fill:rgb(20.392157%,65.882353%,32.54902%);fill-opacity:1;" d="M 130.71875 256 C 165.28125 256 194.1875 244.480469 215.308594 224.960938 L 174.132812 192.960938 C 162.613281 200.640625 148 205.332031 130.71875 205.332031 C 97.332031 205.332031 69.066406 182.828125 58.933594 152.425781 L 16.480469 152.425781 L 16.480469 185.386719 C 37.492188 227.199219 80.691406 256 130.71875 256 Z M 130.71875 256 "/>
            <path style=" stroke:none;fill-rule:nonzero;fill:rgb(98.431373%,73.72549%,1.960784%);fill-opacity:1;" d="M 58.933594 152.425781 C 56.265625 144.746094 54.878906 136.535156 54.878906 128 C 54.878906 119.464844 56.375 111.253906 58.933594 103.574219 L 58.933594 70.613281 L 16.480469 70.613281 C 7.734375 87.894531 2.71875 107.308594 2.71875 128 C 2.71875 148.691406 7.734375 168.105469 16.480469 185.386719 Z M 58.933594 152.425781 "/>
            <path style=" stroke:none;fill-rule:nonzero;fill:rgb(91.764706%,26.27451%,20.784314%);fill-opacity:1;" d="M 130.71875 50.667969 C 149.601562 50.667969 166.453125 57.171875 179.785156 69.867188 L 216.265625 33.386719 C 194.1875 12.691406 165.28125 0 130.71875 0 C 80.691406 0 37.492188 28.800781 16.480469 70.613281 L 58.933594 103.574219 C 69.066406 73.171875 97.332031 50.667969 130.71875 50.667969 Z M 130.71875 50.667969 "/>
          </g>
        </svg>`),
    },
    {
      id: AuthProvider.github,
      title: 'GitHub',
      iconClasses: 'feather-github',
    },
    {
      id: AuthProvider.password,
      title: 'Password',
      iconClasses: 'feather-lock text-red-500',
    },
    {
      id: AuthProvider.link,
      title: 'Email link',
      iconClasses: 'feather-link text-sky-500',
    },
    {
      id: AuthProvider.phone,
      title: 'SMS',
      iconClasses: 'feather-phone text-purple-500',
    },
  ];

  constructor(private readonly sanitizer: DomSanitizer) {}

  getProviders(): ProviderModel[] {
    return this.providerModels.filter(p => this.providers.includes(p.id));
  }
}
