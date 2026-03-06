import { Component, OnInit } from '@angular/core';
import { ColDef } from 'ag-grid-community';

@Component({
  selector: 'app-root',
  template: `
    <div class="container">
      <h1>Angular 15 AG-Grid Performance Debug (Zone.js Enabled)</h1>
      <div class="stats">
        <p>Rows: {{ rowData?.length || 0 }} | Status: {{ status }} | Load Time: {{ loadTime }}ms</p>
        <button (click)="loadData()" [disabled]="loading">{{ loading ? 'Loading...' : 'Load Data' }}</button>
        <button (click)="triggerChangeDetection()" [disabled]="loading">Trigger Change Detection (BAD!)</button>
        <button (click)="addRandomRow()" [disabled]="!rowData">Add Random Row</button>
        <button (click)="updateAllRows()" [disabled]="!rowData">Update All Rows (VERY BAD!)</button>
      </div>
      <ag-grid-angular
        class="ag-theme-alpine"
        [rowData]="rowData"
        [columnDefs]="columnDefs"
        [defaultColDef]="defaultColDef"
        [animateRows]="true"
        [enableCellChangeFlash]="true"
        [suppressColumnVirtualisation]="true"
        [rowBuffer]="50"
        (gridReady)="onGridReady($event)"
        (cellValueChanged)="onCellValueChanged($event)"
        style="width: 100%; height: 700px;">
      </ag-grid-angular>
    </div>
  `,
  styles: [`
    .container {
      padding: 20px;
    }
    h1 {
      color: #333;
      margin-bottom: 20px;
    }
    .stats {
      margin-bottom: 15px;
      padding: 15px;
      background: #f5f5f5;
      border-radius: 5px;
    }
    .stats p {
      margin: 0 0 10px 0;
      font-weight: bold;
    }
    button {
      margin-right: 10px;
      padding: 10px 15px;
      cursor: pointer;
      background: #007bff;
      color: white;
      border: none;
      border-radius: 4px;
    }
    button:hover:not(:disabled) {
      background: #0056b3;
    }
    button:disabled {
      background: #ccc;
      cursor: not-allowed;
    }
  `]
})
export class AppComponent implements OnInit {
  rowData: any[] = [];
  columnDefs: ColDef[] = [];
  gridApi: any;
  status = 'Click "Load Data" to start';
  loading = false;
  loadTime = 0;

  // Intentionally bad default column settings for performance
  defaultColDef: ColDef = {
    sortable: true,
    filter: true,
    resizable: true,
    editable: true,
    // Force cell rendering on every change (BAD for performance!)
    enableCellChangeFlash: true,
  };

  constructor() { }

  ngOnInit() {
    this.setupColumns();

    // Intentionally trigger change detection frequently (BAD!)
    setInterval(() => {
      this.status = `Status: ${new Date().toLocaleTimeString()}`;
    }, 100); // Every 100ms!
  }

  setupColumns() {
    // Create columns dynamically
    this.columnDefs = [
      { field: 'id', headerName: 'ID', width: 80, pinned: 'left' },
      { field: 'firstName', headerName: 'First Name', width: 120 },
      { field: 'lastName', headerName: 'Last Name', width: 120 },
      { field: 'email', headerName: 'Email', width: 200 },
      { field: 'company', headerName: 'Company', width: 150 },
      { field: 'department', headerName: 'Department', width: 130 },
      {
        field: 'salary',
        headerName: 'Salary',
        width: 120,
        valueFormatter: (params) => {
          // Intentionally slow formatter
          let result = '$' + params.value.toLocaleString();
          for (let i = 0; i < 100; i++) {
            result = result.toString();
          }
          return result;
        }
      },
      { field: 'age', headerName: 'Age', width: 80 },
      { field: 'country', headerName: 'Country', width: 100 },
      { field: 'status', headerName: 'Status', width: 100 },
      { field: 'joinDate', headerName: 'Join Date', width: 120 },
      { field: 'lastActive', headerName: 'Last Active', width: 120 },
      { field: 'performanceScore', headerName: 'Performance', width: 120 },
      { field: 'projectsCompleted', headerName: 'Projects', width: 100 },
      { field: 'hoursWorked', headerName: 'Hours', width: 100 },
    ];

    // Add all extra columns
    for (let i = 1; i <= 50; i++) {
      this.columnDefs.push({
        field: `extraField${i}`,
        headerName: `Extra ${i}`,
        width: 150
      });
    }
  }

  async loadData() {
    this.loading = true;
    this.status = 'Loading data...';
    const startTime = performance.now();

    try {
      // Using fetch to load the large JSON file
      const response = await fetch('./data.json');
      const data = await response.json();

      // Intentionally process data in the most inefficient way
      // Clear existing data
      this.rowData = [];

      // Process and update in batches to trigger change detection repeatedly (BAD!)
      const batchSize = 1000;
      for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, Math.min(i + batchSize, data.length));

        // Add batch rows one by one (inefficient!)
        for (const row of batch) {
          this.rowData.push(row);
        }

        // Force grid refresh and change detection (VERY BAD for performance!)
        this.rowData = [...this.rowData]; // Create new array reference

        if (this.gridApi) {
          this.gridApi.setRowData(this.rowData); // Force grid update
        }

        // Yield to browser to show progress (causes jank!)
        await new Promise(resolve => setTimeout(resolve, 0));
        this.status = `Loading... ${this.rowData.length}/${data.length} rows`;
      }

      const endTime = performance.now();
      this.loadTime = Math.round(endTime - startTime);
      this.status = `Loaded ${this.rowData.length} rows`;

    } catch (error) {
      this.status = 'Error loading data. Run "npm run generate-data" first!';
      console.error('Error loading data:', error);
    } finally {
      this.loading = false;
    }
  }

  onGridReady(params: any) {
    this.gridApi = params.api;
    console.log('Grid ready');
  }

  onCellValueChanged(event: any) {
    console.log('Cell changed:', event);
    // Intentionally trigger full grid refresh (VERY BAD!)
    this.gridApi?.refreshCells({ force: true });
  }

  // Intentionally trigger change detection (BAD!)
  triggerChangeDetection() {
    // Rapidly update component property to trigger many change detection cycles
    for (let i = 0; i < 100; i++) {
      this.status = `Change Detection #${i}`;
      // Force synchronous update
      this.rowData = [...this.rowData];
    }
    this.status = 'Triggered 100 change detection cycles!';
  }

  // Add a random row with change detection
  addRandomRow() {
    const newRow = {
      id: this.rowData.length + 1,
      firstName: 'New',
      lastName: 'User',
      email: `new${this.rowData.length}@example.com`,
      company: 'New Company',
      department: 'Engineering',
      salary: 75000,
      age: 30,
      country: 'USA',
      status: 'Active',
      joinDate: new Date().toISOString(),
      lastActive: new Date().toISOString(),
      performanceScore: '85.00',
      projectsCompleted: 0,
      hoursWorked: 0,
    };

    // Add extra fields
    for (let i = 1; i <= 50; i++) {
      (newRow as any)[`extraField${i}`] = `New_Data_${i}`;
    }

    // Trigger change detection by modifying array
    this.rowData = [...this.rowData, newRow];
  }

  // Update all rows - extremely bad for performance!
  updateAllRows() {
    this.status = 'Updating all rows...';

    // Modify every single row to trigger change detection
    this.rowData = this.rowData.map(row => ({
      ...row,
      lastActive: new Date().toISOString(),
      performanceScore: (Math.random() * 100).toFixed(2)
    }));

    this.status = `Updated ${this.rowData.length} rows`;
  }
}
