import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, ViewEncapsulation } from '@angular/core';
import { ONE, TWO, ZERO } from '@seed/shared/constants';

@Component({
  selector: 'seed-pagination',
  templateUrl: './pagination.component.html',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaginationComponent {
  @Input() total = ZERO;

  @Input() limit = ZERO;

  @Input() page = ZERO;

  @Input() isLoading = true;

  @Output() pageChange = new EventEmitter<number>();

  getTotalPages(): number {
    return Math.ceil(this.total / this.limit);
  }

  prevPage(): void {
    this.setPage(this.page - ONE);
  }

  nextPage(): void {
    this.setPage(this.page + ONE);
  }

  setPage(page: number): void {
    this.pageChange.emit(page);
  }

  getPages(): number[] {
    // TODO: make it "1 ... 5 _6_ 7 ... 10"
    const pages = [];
    const totalPages = this.getTotalPages();
    const start = Math.max(this.page - TWO, ONE);
    const end = Math.min(this.page + TWO, totalPages);
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  }
}
