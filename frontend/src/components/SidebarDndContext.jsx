import React from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Wrap any sidebar item to make it draggable within the SortableContext.
// Wraps the *entire* passed children (header + expanded children for groups).
// With activationConstraint distance=8, clicks never accidentally start a drag.
export function SortableItem({ id, disabled = false, children }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition || undefined,
        opacity: isDragging ? 0.35 : 1,
        position: 'relative',
      }}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

// Inner SortableContext for items inside a group (shares the outer DndContext).
export function GroupMemberContext({ ids, children }) {
  return (
    <SortableContext items={ids} strategy={verticalListSortingStrategy}>
      {children}
    </SortableContext>
  );
}

// Wrapper for group items. Exposes drag handle props via render prop so only
// the group header activates drag, not the expanded children beneath it.
export function SortableGroupWrapper({ id, disabled = false, children }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition || undefined,
        opacity: isDragging ? 0.35 : 1,
      }}
    >
      {children({ dragHandleProps: { ref: setActivatorNodeRef, ...attributes, ...listeners }, isDragging })}
    </div>
  );
}

// Main DnD context wrapper. Provides DndContext + top-level SortableContext.
export default function SidebarDndContext({
  topLevelIds,   // number[] — sidebar_item IDs for top-level items (corpus, group, ungrouped graph_tab)
  onDragStart,
  onDragOver,
  onDragEnd,
  overlayContent, // ReactNode shown as drag ghost
  children,
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={topLevelIds} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {overlayContent}
      </DragOverlay>
    </DndContext>
  );
}
