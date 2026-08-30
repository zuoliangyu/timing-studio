export const examples = {
  "SPI 读取": `title: SPI Flash 读取
unit: cycle
signals:
  - name: SCLK
    group: SPI
    clock:
      period: 2
      cycles: 8
      start: 1
  - name: CS_N
    group: SPI
    digital:
      points:
        - { at: 0, value: high }
        - { at: 1, value: low }
        - { at: 17, value: high }
  - name: MOSI
    group: SPI
    bus:
      segments:
        - { from: 1, to: 9, value: "0x9F" }
        - { from: 9, to: 17, value: "ADDR" }
  - name: MISO
    group: SPI
    bus:
      segments:
        - { from: 1, to: 9, value: "Z" }
        - { from: 9, to: 17, value: "0xEF" }
markers:
  - { at: 9, label: "采样" }
`,
  "握手协议": `title: Ready / Valid 握手
unit: cycle
signals:
  - name: CLK
    clock: { period: 2, cycles: 6 }
  - name: VALID
    digital:
      points:
        - { at: 0, value: low }
        - { at: 2, value: high }
        - { at: 8, value: low }
        - { at: 12, value: low }
  - name: READY
    digital:
      points:
        - { at: 0, value: low }
        - { at: 4, value: high }
        - { at: 10, value: low }
        - { at: 12, value: low }
  - name: DATA
    bus:
      segments:
        - { from: 2, to: 5, value: "A5" }
        - { from: 5, to: 8, value: "3C" }
markers:
  - { at: 4, label: "传输" }
`,
};

