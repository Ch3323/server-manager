import { ModeToggle } from "../mode-toggle";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "../ui/breadcrumb";
import { Separator } from "../ui/separator";
import { SidebarTrigger } from "../ui/sidebar";

type SectionNavBarItem = {
    label: string;
    href?: string;
};

export function SectionNavBar({ items }: { items: SectionNavBarItem[] }) {
    const crumbs = items.flatMap((item, index) => {
        const isLast = index === items.length - 1;
        const keyBase = `${item.href ?? "page"}-${item.label}-${index}`;
        const node = (
            <BreadcrumbItem key={`item-${keyBase}`}>
                {isLast || !item.href ? (
                    <BreadcrumbPage>{item.label}</BreadcrumbPage>
                ) : (
                    <BreadcrumbLink href={item.href}>{item.label}</BreadcrumbLink>
                )}
            </BreadcrumbItem>
        );

        if (isLast) {
            return [node];
        }

        return [node, <BreadcrumbSeparator key={`sep-${keyBase}`} />];
    });

    return (
        <nav className="w-full inline-flex items-center justify-between border-b px-4 py-2">
            <div className="inline-flex items-center justify-start gap-4">
                <SidebarTrigger />
                <Separator orientation="vertical" className="data-[orientation=vertical]:h-7" />
                <Breadcrumb>
                    <BreadcrumbList>{crumbs}</BreadcrumbList>
                </Breadcrumb>
            </div>
            <ModeToggle />
        </nav>
    )
}