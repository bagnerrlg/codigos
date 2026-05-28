import pandas as pd
import json
from datetime import datetime

def mock_expenditure_dashboard():
    from expenditure_processor import generate_html_dashboard
    df_fb = pd.DataFrame([
        {"SECUENCIA": "A03-A", "Día": "2024-05-01", "Importe gastado": 100.5, "Contactos mensajes nuevos": 10, "Nombre de la página": "Page 1"},
        {"SECUENCIA": "A02-A", "Día": "2024-05-02", "Importe gastado": 200.0, "Contactos mensajes nuevos": 15, "Nombre de la página": "Page 2"}
    ])
    df_metas = pd.DataFrame([
        {"SUB_ANILLO": "A03-A", "GERENTE": "GERENTE 1", "MARCA": "MARCA 1", "META": 1000},
        {"SUB_ANILLO": "A02-A", "GERENTE": "GERENTE 2", "MARCA": "MARCA 2", "META": 2000}
    ])
    generate_html_dashboard(df_fb, df_metas)
    return "dashboard_gasto_fb.html"

def mock_sales_dashboard():
    from sales_processor import App
    import pandas as pd
    import json

    # Manually extract the template logic from sales_processor or just mock the file
    df = pd.DataFrame([
        {"secuencia": "DELCAM", "asignado": "VENDEDOR 1", "Valor del cliente potencial": 5000, "Fecha": "2024-05-01"},
        {"secuencia": "DHOGDOR", "asignado": "VENDEDOR 2", "Valor del cliente potencial": 3000, "Fecha": "2024-05-02"}
    ])

    # We'll just run a snippet to generate the file
    app = App()
    app.generate_html_dashboard(df)
    return "dashboard_ventas_ghl.html"

if __name__ == "__main__":
    try:
        path_exp = mock_expenditure_dashboard()
        print(f"Generated: {path_exp}")
    except Exception as e:
        print(f"Error Expenditure: {e}")

    try:
        path_sales = mock_sales_dashboard()
        print(f"Generated: {path_sales}")
    except Exception as e:
        print(f"Error Sales: {e}")
