/// Generational handle: low 32 bits index, high 32 bits generation. `0` is never valid.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Handle(pub u64);

impl Handle {
    pub const NULL: Handle = Handle(0);
    pub(crate) fn new(index: u32, generation: u32) -> Self {
        // Generations start at 1 so that a handle is never 0.
        Handle((u64::from(generation) << 32) | u64::from(index))
    }
    pub(crate) fn index(self) -> usize {
        (self.0 & 0xffff_ffff) as usize
    }
    pub(crate) fn generation(self) -> u32 {
        (self.0 >> 32) as u32
    }
}

/// Slot arena with free list and generations.
#[derive(Debug, Clone)]
pub(crate) struct Arena<T> {
    slots: Vec<(u32, Option<T>)>,
    free: Vec<u32>,
    len: usize,
}

impl<T> Default for Arena<T> {
    fn default() -> Self {
        Self {
            slots: Vec::new(),
            free: Vec::new(),
            len: 0,
        }
    }
}

impl<T> Arena<T> {
    pub fn insert(&mut self, v: T) -> Handle {
        self.len += 1;
        if let Some(i) = self.free.pop() {
            let slot = &mut self.slots[i as usize];
            slot.0 = slot.0.wrapping_add(1).max(1);
            slot.1 = Some(v);
            Handle::new(i, slot.0)
        } else {
            self.slots.push((1, Some(v)));
            Handle::new((self.slots.len() - 1) as u32, 1)
        }
    }
    pub fn get(&self, h: Handle) -> Option<&T> {
        self.slots
            .get(h.index())
            .filter(|s| s.0 == h.generation())
            .and_then(|s| s.1.as_ref())
    }
    pub fn get_mut(&mut self, h: Handle) -> Option<&mut T> {
        self.slots
            .get_mut(h.index())
            .filter(|s| s.0 == h.generation())
            .and_then(|s| s.1.as_mut())
    }
    pub fn remove(&mut self, h: Handle) -> Option<T> {
        let slot = self
            .slots
            .get_mut(h.index())
            .filter(|s| s.0 == h.generation())?;
        let v = slot.1.take()?;
        self.free.push(h.index() as u32);
        self.len -= 1;
        Some(v)
    }
    pub fn len(&self) -> usize {
        self.len
    }
    pub fn capacity(&self) -> usize {
        self.slots.len()
    }
    pub fn iter_mut(&mut self) -> impl Iterator<Item = (Handle, &mut T)> {
        self.slots.iter_mut().enumerate().filter_map(|(i, s)| {
            let g = s.0;
            s.1.as_mut().map(|v| (Handle::new(i as u32, g), v))
        })
    }
    pub fn iter(&self) -> impl Iterator<Item = (Handle, &T)> {
        self.slots
            .iter()
            .enumerate()
            .filter_map(|(i, s)| s.1.as_ref().map(|v| (Handle::new(i as u32, s.0), v)))
    }
}
