/**
 * Angular standalone directives for Ultra Motion X.
 * Status: source distribution — compiled by the consuming Angular project (requires
 * `experimentalDecorators`, as Angular projects already enable). Not compiled in this
 * repository's CI because the Angular toolchain is not part of the workspace.
 *
 *   <button umxPress>Save</button>
 *   <div umxDrag [umxDragOptions]="{ axis: 'x', bounds: 'parent' }"></div>
 *   <ul umxLayout [umxLayoutTrigger]="items"> … </ul>
 *   <div umxEnter="modal"></div>
 */
import {
  type AfterViewChecked,
  Directive,
  ElementRef,
  Input,
  inject,
  type OnDestroy,
  type OnInit,
} from "@angular/core";
import {
  type DragController,
  type DragOptions,
  drag,
  enter,
  LayoutTracker,
  press,
  type SemanticRole,
} from "@ultra-motion-x/web";

@Directive({ selector: "[umxPress]", standalone: true })
export class UmxPressDirective implements OnInit, OnDestroy {
  private el = inject(ElementRef<HTMLElement>);
  @Input() umxPressScale?: number;
  private off?: () => void;
  ngOnInit(): void {
    this.off = press(this.el.nativeElement, { scale: this.umxPressScale });
  }
  ngOnDestroy(): void {
    this.off?.();
  }
}

@Directive({ selector: "[umxDrag]", standalone: true })
export class UmxDragDirective implements OnInit, OnDestroy {
  private el = inject(ElementRef<HTMLElement>);
  @Input() umxDragOptions: DragOptions = {};
  controller?: DragController;
  ngOnInit(): void {
    this.controller = drag(this.el.nativeElement, this.umxDragOptions);
  }
  ngOnDestroy(): void {
    this.controller?.destroy();
  }
}

@Directive({ selector: "[umxEnter]", standalone: true })
export class UmxEnterDirective implements OnInit {
  private el = inject(ElementRef<HTMLElement>);
  @Input() umxEnter: SemanticRole | "" = "page";
  ngOnInit(): void {
    enter(this.el.nativeElement, this.umxEnter || "page");
  }
}

@Directive({ selector: "[umxLayout]", standalone: true })
export class UmxLayoutDirective implements OnInit, AfterViewChecked {
  private el = inject(ElementRef<HTMLElement>);
  @Input() umxLayoutTrigger: unknown;
  private tracker?: LayoutTracker;
  private lastTrigger: unknown;
  ngOnInit(): void {
    this.tracker = new LayoutTracker(this.el.nativeElement);
    this.lastTrigger = this.umxLayoutTrigger;
  }
  ngAfterViewChecked(): void {
    if (this.umxLayoutTrigger !== this.lastTrigger) {
      this.lastTrigger = this.umxLayoutTrigger;
      this.tracker?.measure();
    }
  }
}

export const ULTRA_MOTION_DIRECTIVES = [
  UmxPressDirective,
  UmxDragDirective,
  UmxEnterDirective,
  UmxLayoutDirective,
] as const;
